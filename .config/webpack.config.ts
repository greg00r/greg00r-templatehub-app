// @ts-nocheck
import CopyWebpackPlugin from 'copy-webpack-plugin';
import ForkTsCheckerWebpackPlugin from 'fork-ts-checker-webpack-plugin';
import MiniCssExtractPlugin from 'mini-css-extract-plugin';
import ReplaceInFileWebpackPlugin from 'replace-in-file-webpack-plugin';
import TerserPlugin from 'terser-webpack-plugin';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import type { Configuration } from 'webpack';

// ESM-compatible __dirname / __filename
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const require = createRequire(import.meta.url);
const pluginJson = require('../src/plugin.json');

interface WebpackEnv {
  production?: boolean;
  development?: boolean;
}

export default async (env: WebpackEnv): Promise<Configuration> => {
  const baseDir = path.resolve(__dirname, '..');
  const srcDir = path.resolve(baseDir, 'src');
  const distDir = path.resolve(baseDir, 'dist');
  const isProduction = env.production === true;
  const buildVersion = process.env.PLUGIN_BUILD_VERSION || process.env.npm_package_version || '1.0.0';
  const buildDate = process.env.PLUGIN_BUILD_DATE || new Date().toISOString().substring(0, 10);

  const config: Configuration = {
    context: baseDir,
    devtool: isProduction ? 'source-map' : 'eval-source-map',
    entry: {
      module: path.resolve(srcDir, 'module.ts'),
    },
    output: {
      clean: true,
      filename: '[name].js',
      library: {
        type: 'amd',
      },
      path: distDir,
      publicPath: `public/plugins/${pluginJson.id}/`,
      uniqueName: pluginJson.id,
    },
    externals: [
      'lodash',
      'jquery',
      'moment',
      'slate',
      'emotion',
      '@emotion/react',
      '@emotion/css',
      'prismjs',
      'slate-plain-serializer',
      '@grafana/slate-react',
      'react',
      'react-dom',
      'react-redux',
      'redux',
      'rxjs',
      'react-router-dom',
      'd3',
      'angular',
      '@grafana/ui',
      '@grafana/runtime',
      '@grafana/data',
      {
        'react/jsx-runtime': 'react/jsx-runtime',
        'react/jsx-dev-runtime': 'react/jsx-dev-runtime',
      },
    ],
    module: {
      rules: [
        {
          exclude: /(node_modules)/,
          test: /\.[tj]sx?$/,
          use: {
            loader: 'swc-loader',
            options: {
              jsc: {
                baseUrl: srcDir,
                target: 'es2018',
                loose: false,
                parser: {
                  syntax: 'typescript',
                  tsx: true,
                  decorators: false,
                  dynamicImport: true,
                },
              },
            },
          },
        },
        {
          test: /\.css$/,
          use: [MiniCssExtractPlugin.loader, 'css-loader'],
        },
        {
          test: /\.(sa|sc)ss$/,
          use: [MiniCssExtractPlugin.loader, 'css-loader', 'sass-loader'],
        },
        {
          test: /\.(png|jpe?g|gif|svg)$/,
          type: 'asset/resource',
          generator: {
            // Keep img directory and original extension
            filename: Boolean(isProduction) ? 'img/[name].[contenthash:8][ext]' : 'img/[name][ext]',
          },
        },
        {
          test: /\.(woff|woff2|eot|ttf|otf)(\?v=\d+\.\d+\.\d+)?$/,
          type: 'asset/resource',
          generator: {
            filename: Boolean(isProduction) ? 'fonts/[name].[contenthash:8][ext]' : 'fonts/[name][ext]',
          },
        },
      ],
    },
    optimization: {
      minimize: isProduction,
      minimizer: [
        new TerserPlugin({
          terserOptions: {
            compress: {
              drop_console: isProduction,
            },
          },
        }),
      ],
    },
    plugins: [
      new MiniCssExtractPlugin({ filename: 'styles.css' }),
      new CopyWebpackPlugin({
        patterns: [
          {
            context: path.join(baseDir, 'src'),
            from: 'plugin.json',
            to: '.',
            transform: (content: Buffer) => {
              return content
                .toString()
                .replace(/\%VERSION\%/g, buildVersion);
            },
          },
          { context: path.join(baseDir, 'src'), from: 'img', to: 'img', noErrorOnMissing: true },
          { from: 'CHANGELOG.md', to: '.', force: true, noErrorOnMissing: true },
        ],
      }),
      // Type checking runs separately via `npm run typecheck`.
      // ForkTsCheckerWebpackPlugin is excluded to avoid blocking the build on type errors.
      ...(isProduction
        ? [
            new ReplaceInFileWebpackPlugin([
              {
                dir: distDir,
                files: ['plugin.json'],
                rules: [
                  { search: /\%VERSION\%/g, replace: buildVersion },
                  { search: /\%TODAY\%/g, replace: buildDate },
                ],
              },
            ]),
          ]
        : []),
    ],
    resolve: {
      extensions: ['.js', '.jsx', '.ts', '.tsx'],
      modules: [path.resolve(baseDir, 'src'), 'node_modules'],
      unsafeCache: true,
    },
  };

  return config;
};
