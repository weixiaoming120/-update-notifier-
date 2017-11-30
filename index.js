'use strict';//严格使用
const spawn = require('child_process').spawn;//声明spawn对象，引入进程模块
const path = require('path');//声明path对象，引入path模块（Node.js path 模块提供了一些用于处理文件路径的小工具）
const format = require('util').format;//声明format对象，访问util中的format模块（util.format返回一个格式化的字符串）
const importLazy = require('import-lazy')(require);

const configstore = importLazy('configstore');
const chalk = importLazy('chalk');
const semverDiff = importLazy('semver-diff');
const latestVersion = importLazy('latest-version');
const isNpm = importLazy('is-npm');
const isInstalledGlobally = importLazy('is-installed-globally');
const boxen = importLazy('boxen');
const xdgBasedir = importLazy('xdg-basedir');
const isCi = importLazy('is-ci');
const ONE_DAY = 1000 * 60 * 60 * 24;

class UpdateNotifier {
	constructor(options) {
		options = options || {};
		this.options = options;
		options.pkg = options.pkg || {};

		// Reduce pkg to the essential keys. with fallback to deprecated options
		//将pkg减少到必要的键，回退到不推荐选项
		// TODO: Remove deprecated options at some point far into the future
		//TODO: 在将来的某个时候删除弃用的选项
		
		options.pkg = {
			name: options.pkg.name || options.packageName,
			version: options.pkg.version || options.packageVersion
		};

		if (!options.pkg.name || !options.pkg.version) {
			throw new Error('pkg.name and pkg.version required');
		}

		this.packageName = options.pkg.name;
		this.packageVersion = options.pkg.version;
		this.updateCheckInterval = typeof options.updateCheckInterval === 'number' ? options.updateCheckInterval : ONE_DAY;
		this.hasCallback = typeof options.callback === 'function';
		this.callback = options.callback || (() => {});
		this.disabled = 'NO_UPDATE_NOTIFIER' in process.env ||
			process.argv.indexOf('--no-update-notifier') !== -1 ||
			isCi();

		if (!this.disabled && !this.hasCallback) {
			try {
				const ConfigStore = configstore();
				this.config = new ConfigStore(`update-notifier-${this.packageName}`, {
					optOut: false,
					// Init with the current time so the first check is only
					//用当前时间初始化，所以第一次检查是唯一的
					// after the set interval, so not to bother users right away
					//设定时间间隔，以免马上打扰到用户
					lastUpdateCheck: Date.now()
				});
			} catch (err) {
				// Expecting error code EACCES or EPERM
				const msg =
					chalk().yellow(format(' %s update check failed ', options.pkg.name)) +
					format('\n Try running with %s or get access ', chalk().cyan('sudo')) +
					'\n to the local update config store via \n' +
					chalk().cyan(format(' sudo chown -R $USER:$(id -gn $USER) %s ', xdgBasedir().config));

				process.on('exit', () => {
					console.error('\n' + boxen()(msg, {align: 'center'}));
				});
			}
		}
	}
	check() {
		if (this.hasCallback) {
			this.checkNpm()
				.then(update => this.callback(null, update))
				.catch(err => this.callback(err));
			return;
		}

		if (
			!this.config ||
			this.config.get('optOut') ||
			this.disabled
		) {
			return;
		}

		this.update = this.config.get('update');

		if (this.update) {
			this.config.delete('update');
		}

		// Only check for updates on a set interval
		if (Date.now() - this.config.get('lastUpdateCheck') < this.updateCheckInterval) {
			return;
		}

		// Spawn a detached process, passing the options as an environment property
		spawn(process.execPath, [path.join(__dirname, 'check.js'), JSON.stringify(this.options)], {
			detached: true,
			stdio: 'ignore'
		}).unref();
	}
	checkNpm() {
		return latestVersion()(this.packageName).then(latestVersion => {
			return {
				latest: latestVersion,
				current: this.packageVersion,
				type: semverDiff()(this.packageVersion, latestVersion) || 'latest',
				name: this.packageName
			};
		});
	}
	notify(opts) {
		if (!process.stdout.isTTY || isNpm() || !this.update) {
			return this;
		}

		opts = Object.assign({isGlobal: isInstalledGlobally()}, opts);

		opts.message = opts.message || 'Update available ' + chalk().dim(this.update.current) + chalk().reset(' → ') +
			chalk().green(this.update.latest) + ' \nRun ' + chalk().cyan('npm i ' + (opts.isGlobal ? '-g ' : '') + this.packageName) + ' to update';

		opts.boxenOpts = opts.boxenOpts || {
			padding: 1,
			margin: 1,
			align: 'center',
			borderColor: 'yellow',
			borderStyle: 'round'
		};

		const message = '\n' + boxen()(opts.message, opts.boxenOpts);

		if (opts.defer === false) {
			console.error(message);
		} else {
			process.on('exit', () => {
				console.error(message);
			});

			process.on('SIGINT', () => {
				console.error('');
				process.exit();
			});
		}

		return this;
	}
}

module.exports = options => {
	const updateNotifier = new UpdateNotifier(options);
	updateNotifier.check();
	return updateNotifier;
};

module.exports.UpdateNotifier = UpdateNotifier;
