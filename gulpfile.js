'use strict';

var babel = require('gulp-babel');
var compileSoy = require('metal-tools-soy/lib/pipelines/compileSoy');
var gulp = require('gulp');
var karma = require('karma');
var metal = require('gulp-metal');
var path = require('path');
var replace = require('gulp-replace');

var codeGlobs = [
	'packages/metal*/src/**/*.js',
	'packages/metal*/test/**/*.js',
	'!packages/metal-incremental-dom/**/incremental-dom.js',
	'gulpfile.js',
	'karma.conf.js',
	'karma-coverage.conf.js'
];

metal.registerTasks({
	bundleFileName: 'metal.js',
	formatGlobs: codeGlobs,
	karma: require('karma'),
	// TODO: Find a way to lint jsx files (maybe use eslint instead of jshint).
	lintGlobs: codeGlobs.concat('!packages/metal-jsx/test/**/*.js'),
	testNodeSrc: [
		'env/test/node.js',
		'packages/metal-events/test/**/*.js',
		'packages/metal-state/test/**/*.js',
		'packages/metal.js/test/**/*.js'
	],
	testSaucelabsBrowsers: {
		sl_chrome: {
			base: 'SauceLabs',
			browserName: 'chrome'
		},
		sl_safari: {
			base: 'SauceLabs',
			browserName: 'safari',
			platform: 'OS X 10.10'
		},
		sl_firefox: {
			base: 'SauceLabs',
			browserName: 'firefox'
		},
		sl_ie_9: {
			base: 'SauceLabs',
			browserName: 'internet explorer',
			platform: 'Windows 7',
			version: '9'
		},
		sl_ie_10: {
			base: 'SauceLabs',
			browserName: 'internet explorer',
			platform: 'Windows 7',
			version: '10'
		},
		sl_ie_11: {
			base: 'SauceLabs',
			browserName: 'internet explorer',
			platform: 'Windows 8.1',
			version: '11'
		},
		sl_edge_20: {
			base: 'SauceLabs',
			browserName: 'microsoftedge',
			platform: 'Windows 10',
			version: '20'
		},
		sl_iphone: {
			base: 'SauceLabs',
			browserName: 'iphone',
			platform: 'OS X 10.10',
			version: '7.1'
		},
		sl_android_4: {
			base: 'SauceLabs',
			browserName: 'android',
			platform: 'Linux',
			version: '4.4'
		},
		sl_android_5: {
			base: 'SauceLabs',
			browserName: 'android',
			platform: 'Linux',
			version: '5.0'
		}
	}
});

gulp.task('soy', function() {
	return gulp.src('packages/metal-soy/test/**/*.soy')
		.pipe(compileSoy())
		.pipe(replace('metal-soy', '../..'))
		.pipe(replace('metal-component/src/Component', 'metal-component'))
		.pipe(gulp.dest('packages/metal-soy/test'));
});

var changedJsSrc;
gulp.task('compile', function() {
	return gulp.src(changedJsSrc)
		.pipe(babel())
		.pipe(gulp.dest(calcDestDir(changedJsSrc)));
});

// We need to override gulp-metal's default test:watch task so that it will
// update lib files when the related src files change.
gulp.task('test:watch', ['soy'], function(done) { // jshint ignore:line
	gulp.watch('packages/metal-soy/test/**/*.soy', ['soy']);
	var jsWatcher = gulp.watch('packages/metal*/src/**/*.js', ['compile']);
	jsWatcher.on('change', function(event) {
		changedJsSrc = event.path;
	});

	new karma.Server(
		{
			configFile: path.resolve('karma.conf.js')
		}
	).start();
});

function calcDestDir(src) {
	var relative = path.relative(path.resolve('packages'), src);
	var index = relative.indexOf(path.sep);
	return path.dirname(path.join(
		path.resolve('packages'),
		relative.substr(0, index),
		'lib',
		relative.substr(index + 5)
	));
}
