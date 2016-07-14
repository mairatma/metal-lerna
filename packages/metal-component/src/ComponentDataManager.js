'use strict';

import { array, core, object } from 'metal';
import { EventEmitter, EventEmitterProxy } from 'metal-events';
import State from 'metal-state';

class ComponentDataManager extends EventEmitter {
	/**
	 * Constructor for `ComponentDataManager`.
	 * @param {!Component} component
	 * @param {!Object} data
	 */
	constructor(component, data) {
		super();
		this.component_ = component;

		core.mergeSuperClassesProperty(
			this.constructor,
			'BLACKLIST',
			array.firstDefinedValue
		);
		State.mergeStateStatic(this.component_.constructor);

		this.createState_(data, this.component_);
	}

	/**
	 * Adds a state property to the component.
	 * @param {string} name
	 * @param {!Object} config
	 * @param {*} opt_initialValue
	 */
	add(name, config, opt_initialValue) {
		this.state_.addToState(name, config, opt_initialValue);
	}

	/**
	 * Builds the configuration data that will be passed to the `State` instance.
	 * @param {!Object} data
	 * @return {!Object}
	 * @protected
	 */
	buildStateInstanceData_(data) {
		return object.mixin({}, data, this.component_.constructor.STATE_MERGED);
	}

	/**
	 * Creates the `State` instance that will handle the main component data.
	 * @param {!Object} data
	 * @param {!Object} holder The object that should hold the data properties.
	 * @protected
	 */
	createState_(data, holder) {
		const state = new State({}, holder, this.component_);
		state.setKeysBlacklist_(this.constructor.BLACKLIST_MERGED);
		state.addToState(
			this.buildStateInstanceData_(data),
			this.component_.getInitialConfig()
		);

		const listener = this.emit_.bind(this);
		state.on('stateChanged', listener);
		state.on('stateKeyChanged', listener);
		this.state_ = state;

		this.proxy_ = new EventEmitterProxy(state, this.component_);
	}

	/**
	 * @inheritDoc
	 */
	disposeInternal() {
		super.disposeInternal();

		this.state_.dispose();
		this.state_ = null;

		this.proxy_.dispose();
		this.proxy_ = null;
	}

	/**
	 * Emits the specified event.
	 * @param {!Object} data
	 * @param {!Object} event
	 * @protected
	 */
	emit_(data, event) {
		const orig = event.type;
		const name = orig === 'stateChanged' ? 'dataChanged' : 'dataPropChanged';
		this.emit(name, data);
	}

	/**
	 * Gets the data with the given name.
	 * @param {string} name
	 * @return {*}
	 */
	get(name) {
		return this.state_.get(name);
	}

	/**
	 * Gets the keys for state data that can be synced via `sync` functions.
	 * @return {!Array<string>}
	 */
	getSyncKeys() {
		return this.state_.getStateKeys();
	}

	/**
	 * Gets the keys for state data.
	 * @return {!Array<string>}
	 */
	getStateKeys() {
		return this.state_.getStateKeys();
	}

	/**
	 * Gets the whole state data.
	 * @return {!Object}
	 */
	getState() {
		return this.state_.getState();
	}

	/**
	 * Gets the `State` instance being used.
	 * @return {!Object}
	 */
	getStateInstance() {
		return this.state_;
	}

	/**
	 * Updates all non internal data with the given values (or to the default
	 * value if none is given).
	 * @param {!Object} data
	 */
	replaceNonInternal(data) {
		ComponentDataManager.replaceNonInternal(data, this.state_);
	}

	/**
	 * Updates all non internal data with the given values (or to the default
	 * value if none is given).
	 * @param {!Object} data
	 * @param {!State} state
	 */
	static replaceNonInternal(data, state) {
		const keys = state.getStateKeys();
		for (let i = 0; i < keys.length; i++) {
			const key = keys[i];
			if (!state.getStateKeyConfig(key).internal) {
				if (data.hasOwnProperty(key)) {
					state.set(key, data[key]);
				} else {
					state.setDefaultValue(key);
				}
			}
		}
	}

	/**
	 * Sets the value of all the specified state keys.
	 * @param {!Object.<string,*>} values A map of state keys to the values they
	 *   should be set to.
	 * @param {function()=} opt_callback An optional function that will be run
	 *   after the next batched update is triggered.
	 */
	setState(state, opt_callback) {
		this.state_.setState(state, opt_callback);
	}
}

ComponentDataManager.BLACKLIST = {
	components: true,
	element: true,
	wasRendered: true
};

export default ComponentDataManager;
