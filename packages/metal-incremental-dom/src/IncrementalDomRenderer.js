'use strict';

import './incremental-dom';
import { core, object } from 'metal';
import dom from 'metal-dom';
import { domData } from 'metal-dom';
import { Component, ComponentRegistry, ComponentRenderer } from 'metal-component';
import IncrementalDomAop from './IncrementalDomAop';
import IncrementalDomChildren from './children/IncrementalDomChildren';
import IncrementalDomUnusedComponents from './cleanup/IncrementalDomUnusedComponents';
import IncrementalDomUtils from './utils/IncrementalDomUtils';

/**
 * Class responsible for rendering components via incremental dom.
 */
class IncrementalDomRenderer extends ComponentRenderer {
	/**
	 * @inheritDoc
	 */
	constructor(comp) {
		super(comp);

		comp.context = {};
		this.config_ = comp.getInitialConfig();
		this.changes_ = {};
		comp.on('attached', this.handleAttached_.bind(this));

		var manager = comp.getDataManager();
		if (!this.component_.constructor.SYNC_UPDATES_MERGED) {
			// If the component is being updated synchronously we'll just reuse the
			// `handleComponentRendererStateKeyChanged_` function from
			// `ComponentRenderer`.
			manager.on('dataPropChanged', this.handleDataPropChanged_.bind(this));
		}

		manager.add(
			'children',
			{
				validator: Array.isArray,
				value: emptyChildren_
			},
			this.config_.children || emptyChildren_
		);

		// Binds functions that will be used many times, to avoid creating new
		// functions each time.
		this.handleInterceptedAttributesCall_ =
			this.handleInterceptedAttributesCall_.bind(this);
		this.handleInterceptedCloseCall_ =
			this.handleInterceptedCloseCall_.bind(this);
		this.handleInterceptedOpenCall_ =
			this.handleInterceptedOpenCall_.bind(this);
		this.handleChildrenCaptured_ = this.handleChildrenCaptured_.bind(this);
		this.handleChildRender_ = this.handleChildRender_.bind(this);
		this.renderInsidePatchDontSkip_ = this.renderInsidePatchDontSkip_.bind(this);
	}

	/**
	 * Attaches inline listeners found on the first component render, since those
	 * may come from existing elements on the page that already have
	 * data-on[eventname] attributes set to its final value. This won't trigger
	 * `handleInterceptedAttributesCall_`, so we need manual work to guarantee
	 * that projects using progressive enhancement like this will still work.
	 * @param {!Element} node
	 * @param {!Array} args
	 * @protected
	 */
	attachDecoratedListeners_(node, args) {
		if (!this.component_.wasRendered) {
			var attrs = (args[2] || []).concat(args.slice(3));
			for (var i = 0; i < attrs.length; i += 2) {
				var eventName = this.getEventFromListenerAttr_(attrs[i]);
				if (eventName && !node[eventName + '__handle__']) {
					this.attachEvent_(node, attrs[i], eventName, attrs[i + 1]);
				}
			}
		}
	}

	/**
	 * Listens to the specified event, attached via incremental dom calls.
	 * @param {!Element} element
	 * @param {string} key
	 * @param {string} eventName
	 * @param {function()|string} fn
	 * @protected
	 */
	attachEvent_(element, key, eventName, fn) {
		var handleKey = eventName + '__handle__';
		if (element[handleKey]) {
			element[handleKey].removeListener();
			element[handleKey] = null;
		}

		element[key] = fn;
		if (fn) {
			if (core.isString(fn)) {
				if (key[0] === 'd') {
					// Allow data-on[eventkey] listeners to stay in the dom, as they
					// won't cause conflicts.
					element.setAttribute(key, fn);
				}
				fn = this.component_.getListenerFn(fn);
			}
			element[handleKey] = dom.delegate(document, eventName, element, fn);
		} else {
			element.removeAttribute(key);
		}
	}

	/**
	 * Builds the "children" array to be passed to the current component.
	 * @param {!Array<!Object>} children
	 * @return {!Array<!Object>}
	 * @protected
	 */
	buildChildren_(children) {
		return children.length === 0 ? emptyChildren_ : children;
	}

	/**
	 * Removes the most recent component from the queue of rendering components.
	 */
	static finishedRenderingComponent() {
		renderingComponents_.pop();
		if (renderingComponents_.length === 0) {
			IncrementalDomUnusedComponents.disposeUnused();
		}
	}

	/**
	 * Gets the component being currently rendered via `IncrementalDomRenderer`.
	 * @return {Component}
	 */
	static getComponentBeingRendered() {
		return renderingComponents_[renderingComponents_.length - 1];
	}

	/**
	 * Gets the data object that should be currently used. This object will either
	 * come from the current element being rendered by incremental dom or from
	 * the component instance being rendered (only when the current element is the
	 * component's direct parent).
	 * @return {!Object}
	 */
	static getCurrentData() {
		var element = IncrementalDOM.currentElement();
		var comp = IncrementalDomRenderer.getComponentBeingRendered();
		var renderer = comp.getRenderer();
		var obj = renderer;
		if (renderer.rootElementReached_ && element !== comp.element.parentNode) {
			obj = domData.get(element);
		}
		obj.incDomData_ = obj.incDomData_ || {
			currComps: {
				keys: {},
				order: {}
			},
			prevComps: {
				keys: {},
				order: {}
			}
		};
		return obj.incDomData_;
	}

	/**
	 * Returns the event name if the given attribute is a listener (of the form
	 * "on<EventName>"), or null if it isn't.
	 * @param {string} attr
	 * @return {?string}
	 * @protected
	 */
	getEventFromListenerAttr_(attr) {
		var matches = IncrementalDomRenderer.LISTENER_REGEX.exec(attr);
		var eventName = matches ? (matches[1] ? matches[1] : matches[2]) : null;
		return eventName ? eventName.toLowerCase() : null;
	}

	/**
	 * Gets the component that is this component's owner (that is, the one that
	 * passed its data and holds its ref), or null if there's none.
	 * @return {Component}
	 */
	getOwner() {
		return this.owner_;
	}

	/**
	 * Gets the component that is this component's parent (that is, the one that
	 * actually rendered it), or null if there's no parent.
	 * @return {Component}
	 */
	getParent() {
		return this.parent_;
	}

	/**
	 * Gets the sub component referenced by the given tag and config data,
	 * creating it if it doesn't yet exist.
	 * @param {string|!Function} tagOrCtor The tag name.
	 * @param {!Object} config The config object for the sub component.
	 * @return {!Component} The sub component.
	 * @protected
	 */
	getSubComponent_(tagOrCtor, config) {
		var Ctor = tagOrCtor;
		if (core.isString(Ctor)) {
			Ctor = ComponentRegistry.getConstructor(tagOrCtor);
		}

		var data = IncrementalDomRenderer.getCurrentData();
		var comp;
		if (core.isDef(config.ref)) {
			comp = this.match_(this.component_.components[config.ref], Ctor, config);
			this.component_.addSubComponent(config.ref, comp);
		} else if (core.isDef(config.key)) {
			comp = this.match_(data.prevComps.keys[config.key], Ctor, config);
			data.currComps.keys[config.key] = comp;
		} else {
			var type = core.getUid(Ctor, true);
			data.currComps.order[type] = data.currComps.order[type] || [];
			var order = data.currComps.order[type];
			comp = this.match_((data.prevComps.order[type] || [])[order.length], Ctor, config);
			order.push(comp);
		}

		return comp;
	}

	/**
	 * Guarantees that the component's element has a parent. That's necessary
	 * when calling incremental dom's `patchOuter` for now, as otherwise it will
	 * throw an error if the element needs to be replaced.
	 * @return {Element} The parent, in case it was added.
	 * @protected
	 */
	guaranteeParent_() {
		var element = this.component_.element;
		if (!element || !element.parentNode) {
			var parent = document.createElement('div');
			if (element) {
				dom.append(parent, element);
			}
			return parent;
		}
	}

	/**
	 * Handles the `attached` listener. Stores attach data.
	 * @param {!Object} data
	 * @protected
	 */
	handleAttached_(data) {
		this.attachData_ = data;
	}

	/**
	 * Handles the event of children having finished being captured.
	 * @param {!Object} The captured children in tree format.
	 * @protected
	 */
	handleChildrenCaptured_(tree) {
		var {config, tag} = this.componentToRender_;
		config.children = this.buildChildren_(tree.config.children);
		this.componentToRender_ = null;
		this.renderFromTag_(tag, config);
	}

	/**
	 * Handles a child being rendered via `IncrementalDomChildren.render`. Skips
	 * component nodes so that they can be rendered the correct way without
	 * having to recapture both them and their children via incremental dom.
	 * @param {!Object} node
	 * @return {boolean}
	 * @protected
	 */
	handleChildRender_(node) {
		if (node.tag && IncrementalDomUtils.isComponentTag(node.tag)) {
			node.config.children = this.buildChildren_(node.config.children);
			this.renderFromTag_(node.tag, node.config);
			return true;
		}
	}

	/**
	 * Handles the `dataPropChanged` event. Stores data that has changed since the
	 * last render.
	 * @param {!Object} data
	 * @protected
	 */
	handleDataPropChanged_(data) {
		this.changes_[data.key] = data;
	}

	/**
	 * Handles an intercepted call to the attributes default handler from
	 * incremental dom.
	 * @param {!function()} originalFn The original function before interception.
	 * @param {!Element} element
	 * @param {string} name
	 * @param {*} value
	 * @protected
	 */
	handleInterceptedAttributesCall_(originalFn, element, name, value) {
		var eventName = this.getEventFromListenerAttr_(name);
		if (eventName) {
			this.attachEvent_(element, name, eventName, value);
			return;
		}

		if (name === 'checked') {
			// This is a temporary fix to account for incremental dom setting
			// "checked" as an attribute only, which can cause bugs since that won't
			// necessarily check/uncheck the element it's set on. See
			// https://github.com/google/incremental-dom/issues/198 for more details.
			value = core.isDefAndNotNull(value) && value !== false;
		}

		if (name === 'value') {
			// This is a temporary fix to account for incremental dom setting
			// "value" as an attribute only, which can cause bugs since that won't
			// necessarily update the input's content it's set on. See
			// https://github.com/google/incremental-dom/issues/239 for more details.
			element[name] = value;
		}

		if (core.isBoolean(value)) {
			// Incremental dom sets boolean values as string data attributes, which
			// is counter intuitive. This changes the behavior to use the actual
			// boolean value.
			element[name] = value;
			if (value) {
				element.setAttribute(name, '');
			} else {
				element.removeAttribute(name);
			}
		} else {
			originalFn(element, name, value);
		}
	}

	/**
	 * Handles an intercepted call to the `elementClose` function from incremental
	 * dom.
	 * @param {!function()} originalFn The original function before interception.
	 * @param {string} tag
	 * @protected
	 */
	handleInterceptedCloseCall_(originalFn, tag) {
		var element = originalFn(tag);
		this.resetData_(domData.get(element).incDomData_);
		return element;
	}

	/**
	 * Handles an intercepted call to the `elementOpen` function from incremental
	 * dom.
	 * @param {!function()} originalFn The original function before interception.
	 * @param {string} tag
	 * @protected
	 */
	handleInterceptedOpenCall_(originalFn, tag) {
		if (IncrementalDomUtils.isComponentTag(tag)) {
			return this.handleSubComponentCall_.apply(this, arguments);
		} else {
			return this.handleRegularCall_.apply(this, arguments);
		}
	}

	/**
	 * Handles the `dataPropChanged` event. Overrides original method from
	 * `ComponentRenderer` to guarantee that `IncrementalDomRenderer`'s logic
	 * will run first.
	 * @param {!Object} data
	 * @override
	 * @protected
	 */
	handleManagerDataPropChanged_(data) {
		this.handleDataPropChanged_(data);
		super.handleManagerDataPropChanged_(data);
	}

	/**
	 * Handles an intercepted call to the `elementOpen` function from incremental
	 * dom, done for a regular element. Adds any inline listeners found on the
	 * first render and makes sure that component root elements are always reused.
	 * @param {!function()} originalFn The original function before interception.
	 * @protected
	 */
	handleRegularCall_(originalFn, ...args) {
		var currComp = IncrementalDomRenderer.getComponentBeingRendered();
		var currRenderer = currComp.getRenderer();
		if (!currRenderer.rootElementReached_ && currRenderer.config_.key) {
			args[1] = currRenderer.config_.key;
		}

		var node = originalFn.apply(null, args);
		this.attachDecoratedListeners_(node, args);
		this.updateElementIfNotReached_(node);
		return node;
	}

	/**
	 * Handles an intercepted call to the `elementOpen` function from incremental
	 * dom, done for a sub component element. Creates and updates the appropriate
	 * sub component.
	 * @param {!function()} originalFn The original function before interception.
	 * @protected
	 */
	handleSubComponentCall_(originalFn, ...args) {
		var config = IncrementalDomUtils.buildConfigFromCall(args);
		this.componentToRender_ = {
			config,
			tag: args[0]
		};
		IncrementalDomChildren.capture(this, this.handleChildrenCaptured_);
	}

	/**
	 * Intercepts incremental dom calls from this component.
	 * @protected
	 */
	intercept_() {
		IncrementalDomAop.startInterception({
			attributes: this.handleInterceptedAttributesCall_,
			elementClose: this.handleInterceptedCloseCall_,
			elementOpen: this.handleInterceptedOpenCall_
		});
	}

	/**
	 * Checks if the given object is an incremental dom node.
	 * @param {!Object} node
	 * @return {boolean}
	 */
	static isIncDomNode(node) {
		return !!node[IncrementalDomChildren.CHILD_OWNER];
	}

	/**
	 * Returns the given component if it matches the specified constructor
	 * function. Otherwise, returns a new instance of the given constructor. On
	 * both cases the component's state and config will be updated.
	 * @param {Component} comp
	 * @param {!function()} Ctor
	 * @param {!Object} config
	 * @return {!Component}
	 * @protected
	 */
	match_(comp, Ctor, config) {
		if (!comp || comp.constructor !== Ctor) {
			comp = new Ctor(config, false);
		}
		if (comp.wasRendered) {
			comp.getRenderer().startSkipUpdates();
			comp.getDataManager().replaceNonInternal(config);
			comp.getRenderer().stopSkipUpdates();
		}
		comp.getRenderer().config_ = config;
		return comp;
	}

	/**
	 * Patches the component's element with the incremental dom function calls
	 * done by `renderInsidePatchDontSkip_`.
	 */
	patch() {
		if (!this.component_.element && this.parent_) {
			// If the component has no content but was rendered from another component,
			// we'll need to patch this parent to make sure that any new content will
			// be added in the right place.
			this.parent_.getRenderer().patch();
			return;
		}

		var tempParent = this.guaranteeParent_();
		if (tempParent) {
			IncrementalDOM.patch(tempParent, this.renderInsidePatchDontSkip_);
			dom.exitDocument(this.component_.element);
			if (this.component_.element && this.component_.inDocument) {
				this.component_.renderElement_(
					this.attachData_.parent,
					this.attachData_.sibling
				);
			}
		} else {
			var element = this.component_.element;
			IncrementalDOM.patchOuter(element, this.renderInsidePatchDontSkip_);
			if (!this.component_.element) {
				dom.exitDocument(element);
			}
		}
	}

	/**
	 * Creates and renders the given function, which can either be a simple
	 * incremental dom function or a component constructor.
	 * @param {!function()} fnOrCtor Either be a simple incremental dom function
	 or a component constructor.
	 * @param {Object|Element=} opt_dataOrElement Optional config data for the
	 *     function or parent for the rendered content.
	 * @param {Element=} opt_parent Optional parent for the rendered content.
	 * @return {!Component} The rendered component's instance.
	 */
	static render(fnOrCtor, opt_dataOrElement, opt_parent) {
		if (!Component.isComponentCtor(fnOrCtor)) {
			var fn = fnOrCtor;
			class TempComponent extends Component {
				created() {
					if (IncrementalDomRenderer.getComponentBeingRendered()) {
						this.getRenderer().updateContext_(this);
					}
				}

				render() {
					fn(this.getRenderer().config_);
				}
			}
			TempComponent.RENDERER = IncrementalDomRenderer;
			fnOrCtor = TempComponent;
		}
		return Component.render(fnOrCtor, opt_dataOrElement, opt_parent);
	}

	/**
	 * Renders the renderer's component for the first time, patching its element
	 * through the incremental dom function calls done by `renderIncDom`.
	 */
	render() {
		this.patch();
	}

	/**
	 * Renders the given child node via its owner renderer.
	 * @param {!Object} child
	 */
	static renderChild(child) {
		child[IncrementalDomChildren.CHILD_OWNER].renderChild(child);
	}

	/**
	 * Renders the given child node.
	 * @param {!Object} child
	 */
	renderChild(child) {
		this.intercept_();
		IncrementalDomChildren.render(child, this.handleChildRender_);
		IncrementalDomAop.stopInterception();
	}

	/**
	 * Renders the contents for the given tag.
	 * @param {!function()|string} tag
	 * @param {!Object} config
	 * @protected
	 */
	renderFromTag_(tag, config) {
		if (core.isString(tag) || tag.prototype.getRenderer) {
			var comp = this.renderSubComponent_(tag, config);
			this.updateElementIfNotReached_(comp.element);
			return comp.element;
		} else {
			return tag(config);
		}
	}

	/**
	 * Calls functions from `IncrementalDOM` to build the component element's
	 * content. Can be overriden by subclasses (for integration with template
	 * engines for example).
	 */
	renderIncDom() {
		if (this.component_.render) {
			this.component_.render();
		} else {
			IncrementalDOM.elementVoid('div');
		}
	}

	/**
	 * Runs the incremental dom functions for rendering this component, but
	 * doesn't call `patch` yet. Rather, this will be the function that should be
	 * called by `patch`.
	 */
	renderInsidePatch() {
		if (this.component_.wasRendered &&
			!this.shouldUpdate(this.changes_) &&
			IncrementalDOM.currentPointer() === this.component_.element) {
			if (this.component_.element) {
				IncrementalDOM.skipNode();
			}
			return;
		}
		this.renderInsidePatchDontSkip_();
	}

	/**
	 * The same as `renderInsidePatch`, but without the check that may skip the
	 * render action.
	 * @protected
	 */
	renderInsidePatchDontSkip_() {
		IncrementalDomRenderer.startedRenderingComponent(this.component_);
		this.changes_ = {};
		this.rootElementReached_ = false;
		IncrementalDomUnusedComponents.schedule(this.childComponents_ || []);
		this.childComponents_ = [];
		this.intercept_();
		this.renderIncDom();
		IncrementalDomAop.stopInterception();
		if (!this.rootElementReached_) {
			this.component_.element = null;
		} else {
			this.component_.addElementClasses();
		}
		this.emit('rendered', !this.isRendered_);
		IncrementalDomRenderer.finishedRenderingComponent();
		this.resetData_(this.incDomData_);
	}

	/**
	 * This updates the sub component that is represented by the given data.
	 * The sub component is created, added to its parent and rendered. If it
	 * had already been rendered before though, it will only have its state
	 * updated instead.
	 * @param {string|!function()} tagOrCtor The tag name or constructor function.
	 * @param {!Object} config The config object for the sub component.
	 * @return {!Component} The updated sub component.
	 * @protected
	 */
	renderSubComponent_(tagOrCtor, config) {
		var comp = this.getSubComponent_(tagOrCtor, config);
		this.updateContext_(comp);
		var renderer = comp.getRenderer();
		if (renderer instanceof IncrementalDomRenderer) {
			var parentComp = IncrementalDomRenderer.getComponentBeingRendered();
			parentComp.getRenderer().childComponents_.push(comp);
			renderer.parent_ = parentComp;
			renderer.owner_ = this.component_;
			renderer.renderInsidePatch();
		} else {
			console.warn(
				'IncrementalDomRenderer doesn\'t support rendering sub components ' +
				'that don\'t use IncrementalDomRenderer as well, like:',
				comp
			);
		}
		if (!comp.wasRendered) {
			comp.renderAsSubComponent();
		}
		return comp;
	}

	/**
	 * Resets the given incremental dom data object, preparing it for the next
	 * pass.
	 * @param {Object}
	 * @protected
	 */
	resetData_(data) {
		if (data) {
			data.prevComps.keys = data.currComps.keys;
			data.prevComps.order = data.currComps.order;
			data.currComps.keys = {};
			data.currComps.order = {};
		}
	}

	/**
	 * Checks if the component should be updated with the current state changes.
	 * Can be overridden by subclasses or implemented by components to provide
	 * customized behavior (only updating when a state property used by the
	 * template changes, for example).
	 * @param {!Object} changes
	 * @return {boolean}
	 */
	shouldUpdate(changes) {
		if (this.component_.shouldUpdate) {
			return this.component_.shouldUpdate(changes);
		}
		return true;
	}

	/**
	 * Stores the component that has just started being rendered.
	 * @param {!Component} comp
	 */
	static startedRenderingComponent(comp) {
		renderingComponents_.push(comp);
	}

	/**
	 * Updates the renderer's component when state changes, patching its element
	 * through the incremental dom function calls done by `renderIncDom`. Makes
	 * sure that it won't cause a rerender if the only change was for the
	 * "element" property.
	 */
	update() {
		var changed = Object.keys(this.changes_).length > 0;
		if (changed && this.shouldUpdate(this.changes_)) {
			this.patch();
		}
	}

	/**
	 * Updates this renderer's component's element with the given values, unless
	 * it has already been reached by an earlier call.
	 * @param {!Element} node
	 * @protected
	 */
	updateElementIfNotReached_(node) {
		var currComp = IncrementalDomRenderer.getComponentBeingRendered();
		var currRenderer = currComp.getRenderer();
		if (!currRenderer.rootElementReached_) {
			currRenderer.rootElementReached_ = true;
			if (currComp.element !== node) {
				currComp.element = node;
			}
		}
	}

	/**
	 * Updates the given component's context according to the data from the
	 * component that is currently being rendered.
	 * @param {!Component} comp
	 * @protected
	 */
	updateContext_(comp) {
		var context = comp.context;
		var parent = IncrementalDomRenderer.getComponentBeingRendered();
		var childContext = parent.getChildContext ? parent.getChildContext() : {};
		object.mixin(context, parent.context, childContext);
		comp.context = context;
	}
}

var renderingComponents_ = [];
var emptyChildren_ = [];

IncrementalDomRenderer.LISTENER_REGEX = /^(?:on([A-Z]\w+))|(?:data-on(\w+))$/;

export default IncrementalDomRenderer;
