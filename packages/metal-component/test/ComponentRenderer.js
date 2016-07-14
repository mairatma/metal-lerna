'use strict';

import core from 'metal';
import Component from '../src/Component';
import ComponentRenderer from '../src/ComponentRenderer';

describe('ComponentRenderer', function() {
	var renderer;

	afterEach(function() {
		renderer.dispose();
	});

	it('should call the render method when the component is rendered', function() {
		var component = new Component();

		sinon.spy(ComponentRenderer.prototype, 'render');
		renderer = new ComponentRenderer(component);

		component.emit('render');
		assert.strictEqual(1, renderer.render.callCount);
		ComponentRenderer.prototype.render.restore();
	});

	it('should set element to simple empty div as the default render implementation', function() {
		var component = new Component();
		renderer = new ComponentRenderer(component);
		component.emit('render');

		assert.ok(core.isElement(component.element));
		assert.strictEqual('DIV', component.element.tagName);
	});

	it('should not call the render method after disposed', function() {
		var component = new Component();

		sinon.spy(ComponentRenderer.prototype, 'render');
		renderer = new ComponentRenderer(component);

		renderer.dispose();
		component.emit('render');
		assert.strictEqual(0, renderer.render.callCount);
		ComponentRenderer.prototype.render.restore();
	});

	it('should not call the update method if state changes before render', function(done) {
		var TestComponent = createTestComponent();
		var component = new TestComponent({}, false);
		renderer = new ComponentRenderer(component);
		sinon.spy(renderer, 'update');

		component.foo = 'foo';
		component.once('stateChanged', function() {
			assert.strictEqual(0, renderer.update.callCount);
			done();
		});
	});

	it('should call the update method asynchronously if state changes', function(done) {
		var TestComponent = createTestComponent();
		var component = new TestComponent();
		renderer = new ComponentRenderer(component);
		sinon.spy(renderer, 'update');

		component.emit('render');
		component.foo = 'foo';
		assert.strictEqual(0, renderer.update.callCount);
		component.once('stateChanged', function() {
			assert.strictEqual(1, renderer.update.callCount);
			var expectedData = {
				foo: {
					key: 'foo',
					prevVal: undefined,
					newVal: 'foo'
				}
			};
			assert.deepEqual(expectedData, renderer.update.args[0][0].changes);

			component.foo = 'bar';
			component.once('stateChanged', function() {
				assert.strictEqual(2, renderer.update.callCount);
				expectedData = {
					foo: {
						key: 'foo',
						prevVal: 'foo',
						newVal: 'bar'
					}
				};
				assert.deepEqual(expectedData, renderer.update.args[1][0].changes);
				done();
			});
		});
	});

	it('should not call the update method if state changes while skipping updates', function(done) {
		var TestComponent = createTestComponent();
		var component = new TestComponent();
		renderer = new ComponentRenderer(component);
		sinon.spy(renderer, 'update');

		component.emit('render');
		renderer.startSkipUpdates();
		component.foo = 'foo';
		component.once('stateChanged', function() {
			assert.strictEqual(0, renderer.update.callCount);

			renderer.stopSkipUpdates();
			component.foo = 'foo2';
			component.once('stateChanged', function() {
				assert.strictEqual(1, renderer.update.callCount);
				done();
			});
		});
	});

	it('should not call update method after disposed', function(done) {
		var TestComponent = createTestComponent();
		var component = new TestComponent();
		renderer = new ComponentRenderer(component);
		sinon.spy(renderer, 'update');

		component.emit('render');
		renderer.dispose();

		component.foo = 'foo';
		component.once('stateChanged', function() {
			assert.strictEqual(0, renderer.update.callCount);
			done();
		});
	});

	describe('SYNC_UPDATES', function() {
		it('should call the update method synchronously if state changes', function() {
			var TestComponent = createTestComponent();
			TestComponent.SYNC_UPDATES = true;

			var component = new TestComponent();
			renderer = new ComponentRenderer(component);
			sinon.spy(renderer, 'update');

			component.emit('render');
			component.foo = 'foo';
			var expectedData = {
				foo: {
					key: 'foo',
					prevVal: undefined,
					newVal: 'foo'
				}
			};
			assert.strictEqual(1, renderer.update.callCount);
			assert.deepEqual(expectedData, renderer.update.args[0][0].changes);

			component.foo = 'bar';
			expectedData = {
				foo: {
					key: 'foo',
					prevVal: 'foo',
					newVal: 'bar'
				}
			};
			assert.strictEqual(2, renderer.update.callCount);
			assert.deepEqual(expectedData, renderer.update.args[1][0].changes);
		});

		it('should not call the update method when state changes before render', function() {
			var TestComponent = createTestComponent();
			TestComponent.SYNC_UPDATES = true;

			var component = new TestComponent({}, false);
			renderer = new ComponentRenderer(component);
			sinon.spy(renderer, 'update');

			component.foo = 'foo';
			assert.strictEqual(0, renderer.update.callCount);
		});
	});

	function createTestComponent() {
		class TestComponent extends Component {
		}
		TestComponent.STATE = {
			foo: {
			}
		};
		return TestComponent;
	}
});
