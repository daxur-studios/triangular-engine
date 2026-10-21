// Headless Chrome with WebGPU switched on (software adapter; real GPU only via the browser test runner).
// Any test target: ng run triangular-engine:<target> --watch=false --karma-config=karma.gpu.conf.cjs --browsers=ChromeHeadlessGpu
module.exports = function (config) {
  config.set({
    frameworks: ['jasmine'],
    plugins: [require('karma-jasmine'), require('karma-chrome-launcher')],
    reporters: ['progress'],
    customLaunchers: {
      ChromeHeadlessGpu: {
        base: 'ChromeHeadless',
        flags: [
          '--enable-unsafe-webgpu',
          '--enable-features=Vulkan,WebGPU',
          '--use-angle=d3d11',
          '--ignore-gpu-blocklist',
          '--enable-gpu',
          '--disable-gpu-sandbox',
        ],
      },
    },
  });
};
