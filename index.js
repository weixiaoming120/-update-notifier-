'use strict';//严格使用
const spawn = require('child_process').spawn;//声明spawn对象，引入进程模块
const path = require('path');//声明path对象，引入path模块（Node.js path 模块提供了一些用于处理文件路径的小工具）
const format = require('util').format;//声明format对象，访问util中的format模块（util.format返回一个格式化的字符串）
const importLazy = require('import-lazy')(require);//  传递`require`或者一个自定义的导入函数
 
const configstore = importLazy('configstore');// 创建一个具有唯一ID的Configstore实例 
const chalk = importLazy('chalk');//引入粉笔模块
const semverDiff = importLazy('semver-diff');//获得两个DIFF类型semver版本：0.0.1 0.0.2→patchemverDiff（versionA，versionB），返回两个semver版本之间的差异类型，或者null如果它们是相同的，或者第二个比第一个更低。
const latestVersion = importLazy('latest-version');//获取最新版本的npm软件包
const isNpm = importLazy('is-npm');//检测代码是否作为npm脚本运行
const isInstalledGlobally = importLazy('is-installed-globally');//检查您的软件包是否全球安装，如果您的CLI在全局和本地安装时需要不同的行为，可能会很有用
const boxen = importLazy('boxen');//在终端中创建框(创建边框)
const xdgBasedir = importLazy('xdg-basedir');//获取XDG基本目录路径，属性.data，.config，.cache，.runtime将返回null在，无论是XDG环境变量没有设置常见的情况和用户的主目录无法找到
const isCi = importLazy('is-ci');//如果当前环境是连续集成服务器，则返回true 。
const ONE_DAY = 1000 * 60 * 60 * 24;//设置一天的单位时间是24小时
 //创建一个更新CLI应用程序的通知类
class UpdateNotifier {
	//创建一个options对象的构造函数
	constructor(options) {
		//设置options对象是options对象或者空对象
		options = options || {};
		//这个option对象等于option对象
		this.options = options;
		//option中的pkg对象（将Node.js项目打包成一个可执行文件）等于options.pkg或者空对象
		options.pkg = options.pkg || {};

		// Reduce pkg to the essential keys. with fallback to deprecated options
		//将pkg减少到必要的键，回退到不推荐选项
		// TODO: Remove deprecated options at some point far into the future
		//TODO: 在将来的某个时候删除弃用的选项
		
		//定义options.pkg对象的名字、版本
		options.pkg = {
			name: options.pkg.name || options.packageName,
			version: options.pkg.version || options.packageVersion
		};
		//如果没有找到options.pkg对象的名字或者版本信息的话，将跑出一个新的错误：“需要'pkg.name 和 pkg.version”
		if (!options.pkg.name || !options.pkg.version) {
			throw new Error('pkg.name and pkg.version required');
		}
		//如果找到了，定义构造函数中的packageName为项目包（options.pkg.name）的名字，定义packageVersion为项目包

https://www.baidu.com/?tn=62004195_2_oem_dg（options.pkg.version）的版本
		this.packageName = options.pkg.name;
		this.packageVersion = options.pkg.version;
		//设置这里的更新检查区间为等号后面三目运算符得出的结果（判断options.updateCheckInterval的数据类型是否为‘number’ture则options.updateCheckInterval，false则ONE_DAY）
		this.updateCheckInterval = typeof options.updateCheckInterval === 'number' ? options.updateCheckInterval : 

ONE_DAY;	//设置这里的回调函数为 ：是否options的回调全等于function
		this.hasCallback = typeof options.callback === 'function';
		//设置这里的callback对象为options.callback对象或者是封装一个不包含任何参数的方法
		this.callback = options.callback || (() => {});
		//设置disabled对象为一个字符串‘NO_UPDATE_NOTIFIER’（ process.env：会将属性值转换成字符串）或者返回--no-update-notifier的位置不等于-1，或者为isci()函数
		this.disabled = 'NO_UPDATE_NOTIFIER' in process.env ||
			process.argv.indexOf('--no-update-notifier') !== -1 ||
			isCi();
		//如果非disabled且非hasCallback,抛出一个异常
		if (!this.disabled && !this.hasCallback) {
			try {
				//创建ConfigStore对象，调用configstore（）方法（configstore()：获取文件存储配置）
				const ConfigStore = configstore();
				//调用ConfigStore函数，参数为update-notifier-包的名字，函数内容为：输出false，设置时间间隔
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
				//期待错误代码EACCES或EPERM
				const msg =
					chalk().yellow(format(' %s update check failed ', options.pkg.name)) +
					format('\n Try running with %s or get access ', chalk().cyan('sudo')) +
					'\n to the local update config store via \n' +
					chalk().cyan(format(' sudo chown -R $USER:$(id -gn $USER) %s ', xdgBasedir().config));
				//进程进行到控制台输出：错误信息
				process.on('exit', () => {
					console.error('\n' + boxen()(msg, {align: 'center'}));
				});
			}
		}
	}
	//检查更新的函数
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
		//得到更新信息
		this.update = this.config.get('update');
		//如果得到了就删除
		if (this.update) {
			this.config.delete('update');
		}

		// Only check for updates on a set interval
		//只在设定的时间间隔内检查更新
		if (Date.now() - this.config.get('lastUpdateCheck') < this.updateCheckInterval) {
			return;
		}

		// Spawn a detached process, passing the options as an environment property
		//产生一个分离的进程，将选项作为环境属性传递
		spawn(process.execPath, [path.join(__dirname, 'check.js'), JSON.stringify(this.options)], {
			detached: true,
			stdio: 'ignore'
		}).unref();
	}
	//检查包管理器的函数（检测代码是否作为npm脚本运行）
	checkNpm() {
		return latestVersion()(this.packageName).then(latestVersion => {
			//返回的信息：最新版本、当前版本、版本类型、版本名字
			return {
				latest: latestVersion,
				current: this.packageVersion,
				type: semverDiff()(this.packageVersion, latestVersion) || 'latest',
				name: this.packageName
			};
		});
	}
	//通知函数，参数为opts，作用是在一个通知框内通知更新，内容包括：新版本的一些信息
	notify(opts) {
		if (!process.stdout.isTTY || isNpm() || !this.update) {
			return this;
		}

		opts = Object.assign({isGlobal: isInstalledGlobally()}, opts);

		opts.message = opts.message || 'Update available ' + chalk().dim(this.update.current) + chalk().reset(' → ') +
			chalk().green(this.update.latest) + ' \nRun ' + chalk().cyan('npm i ' + (opts.isGlobal ? '-g ' : '') + 

this.packageName) + ' to update';
		//创建边框通知栏
		opts.boxenOpts = opts.boxenOpts || {
			padding: 1,
			margin: 1,
			align: 'center',
			borderColor: 'yellow',
			borderStyle: 'round'
		};
		//创建messag对象，为通知框里的版本信息等
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
//exports 变量是在模块的文件级别作用域内有效的，它在模块被执行前被赋予 module.exports 的值。
//它有一个快捷方式，以便 module.exports.f = ... 可以被更简洁地写成 exports.f = ...。 
//exports是模块往外暴露方法的接口。
//调用UpdateNotifier类里的所有函数并执行，参数为options
module.exports = options => {
	const updateNotifier = new UpdateNotifier(options);
	//调用updateNotifier的check();方法检查更新状态 
	updateNotifier.check();
	return updateNotifier;
};

module.exports.UpdateNotifier = UpdateNotifier;
