'use strict';

import { isDefAndNotNull } from 'metal';
import IncrementalDomRenderer from 'metal-incremental-dom';

/**
 * Renderer that handles JSX.
 */
class JSXRenderer extends IncrementalDomRenderer.constructor {
	/**
	 * @inheritDoc
	 */
	buildShouldUpdateArgs_() {
		return [this.changes_, this.propChanges_];
	}

	/**
	 * @inheritDoc
	 */
	clearChanges_() {
		super.clearChanges_();
		this.propChanges_ = {};
	}

	/**
	 * Called when generating a key for the next dom element to be created via
	 * incremental dom. Adds keys to elements that don't have one yet, according
	 * to their position in the parent. This helps use cases that use
	 * conditionally rendered elements, which is very common in JSX.
	 * @param {!Component} component
	 * @param {string} key
	 * @return {?string}
	 */
	generateKey(component, key) {
		key = super.generateKey(component, key);
		const comp = this.getPatchingComponent();
		const data = comp.getRenderer().getData(comp);
		if (!isDefAndNotNull(key)) {
			if (data.rootElementRendered_) {
				key = JSXRenderer.KEY_PREFIX + JSXRenderer.incElementCount();
			} else if (comp.element && comp.element.__incrementalDOMData) {
				key = comp.element.__incrementalDOMData.key;
			}
		}
		if (!data.rootElementRendered_) {
			data.rootElementRendered_ = true;
		}
		return key;
	}

	/**
	 * @inheritDoc
	 */
	handleStateKeyChanged_(data) {
		if (data.type === 'state') {
			super.handleStateKeyChanged_(data);
		} else {
			this.propChanges_[data.key] = data;
		}
	}

	/**
	 * @inheritDoc
	 */
	hasDataChanged_() {
		return super.hasDataChanged_() || Object.keys(this.propChanges_).length > 0;
	}

	/**
	 * Increments the number of children in the current element.
	 */
	static incElementCount() {
		const node = IncrementalDOM.currentElement();
		node.__metalJsxCount = (node.__metalJsxCount || 0) + 1;
		return node.__metalJsxCount;
	}

	/**
	 * Overrides the original method from `IncrementalDomRenderer` so we can
	 * keep track of if the root element of the patched component has already
	 * been rendered or not.
	 * @param {!Component} component
	 * @override
	 */
	patch(component) {
		this.getData(component).rootElementRendered_ = false;
		super.patch(component);
	}

	/**
	 * Overrides the original method from `IncrementalDomRenderer` to handle the
	 * case where developers return a child node directly from the "render"
	 * function.
	 * @param {!Component} component
	 * @override
	 */
	renderIncDom(component) {
		if (component.render) {
			iDOMHelpers.renderArbitrary(component.render());
		} else {
			super.renderIncDom(component);
		}
	}

	/**
	 * @inheritDoc
	 */
	resetNodeData_(node) {
		super.resetNodeData_(node);
		node.__metalJsxCount = 0;
	}

	/**
	 * Skips the current child in the count (used when a conditional render
	 * decided not to render anything).
	 */
	skipChild() {
		IncrementalDOM.elementVoid(JSXRenderer.incElementCount);
	}

	/**
	 * @inheritDoc
	 */
	skipRender() {
		JSXRenderer.skipChild();
		super.skipRender();
	}
}

JSXRenderer.KEY_PREFIX = '_metal_jsx_';

const jsxRenderer = new JSXRenderer();
jsxRenderer.RENDERER_NAME = 'jsx';

export default jsxRenderer;
