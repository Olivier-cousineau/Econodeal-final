const production = process.env.NODE_ENV === 'production';

const purgecss = require('@fullhuman/postcss-purgecss');

module.exports = {
  plugins: [
    require('postcss-import'),
    require('autoprefixer'),
    production &&
      purgecss({
        content: ['./**/*.html', './assets/js/**/*.js'],
        defaultExtractor: (content) => content.match(/[A-Za-z0-9-_:/]+/g) || [],
        safelist: {
          standard: [
            'hidden',
            'overlay-active',
            'error',
            'success',
            'is-active',
            'is-visible',
            'store-ads--static',
            'locked',
            'is-loading'
          ]
        }
      }),
    production &&
      require('cssnano')({
        preset: 'default'
      })
  ].filter(Boolean)
};
