var cluster = require("cluster");
var os = require("os");
var util = require("util");
var EventEmitter = require('events').EventEmitter;

var async = require("async");
var jsvalidator = require("jsvalidator");

var Cluster = function(args) {}

util.inherits(Cluster, EventEmitter);

Cluster.prototype.init = function(args) {
	var self = this;
	
	jsvalidator.validate(args, {
		type : "object",
		schema : [
			{ name : "numWorkers", type : "number", default : os.cpus().length }, // default to number of CPUs
			{ name : "restartMessage", type : "string", default : "_clustering_restart" },
			{ name : "shutdownMessage", type : "string", default : "_clustering_shutdown" },
			{ name : "onlineMessage", type : "string", default : "_clustering_online" },
			{ name : "clusterSetup", type : "object" },
			{ name : "shutdownCodes", type : "array", schema : { type : "string" }, default : function() { return [42] } },
			{ name : "shutdownExitCode", type : "number", default : function(args) { return args.current.shutdownCodes[0] } }, // use first element from shutdownCodes
			{ name : "master", type : "function" }, // if master we must have master fn
			{ name : "worker", type : "function" }, // if not on master we must have a worker fn
			{ name : "_process", type : "object", default : function() { return process; } }, // for use in test bootstrapping
			{ name : "_cluster", type : "object", default : function() { return cluster; } } // for use in test bootstrapping
		],
		allowExtraKeys : false,
		throwOnInvalid : true,
		required : true
	});
	
	self._initArgs = args;
	self._servers = [];
	self._process = args._process;
	self._cluster = args._cluster;
	
	if (self._cluster.isMaster) {
		if (self._initArgs.clusterSetup !== undefined) {
			self._cluster.setupMaster(self._initArgs.clusterSetup);
		}
		
		self._cluster.on("exit", function(worker, code, signal) {
			if (self._initArgs.shutdownCodes.indexOf(code) !== -1) { return self.emit("workerShutdown") }
			
			self._initWorker();
		});
		
		self._initArgs.master(function() {
			self._initWorkers(function() {
				self.emit("workersOnlineInitial");
			});
		});
	} else {
		self._process.on("message", function(message) {
			if (message === self._initArgs.shutdownMessage) {
				var calls = [];
				
				self._servers.forEach(function(val, i) {
					calls.push(function(cb) {
						val.close(cb);
					});
				});
				
				async.parallel(calls, function(err) {
					if (err) { self.emit("serverCloseError", err); }
					
					self.emit("shutdown");
					
					console.log("shutting down", cluster.worker.id);
					
					self._process.exit(self._initArgs.shutdownExitCode);
				});
			}
		});
		
		self._initArgs.worker();
	}
}

Cluster.prototype._initWorkers = function(cb) {
	var self = this;
	
	var calls = [];
	
	for(var i = 0; i < self._initArgs.numWorkers; i++) {
		calls.push(function(cb) {
			self._initWorker(cb);
		});
	}
	
	async.parallel(calls, function() {
		self.emit("workersOnline");
		
		return cb(null);
	});
}

Cluster.prototype._initWorker = function(cb) {
	var self = this;
	
	cb = cb || function() {};
	
	var worker = self._cluster.fork();
	worker.on("message", function(message) {
		if (message === self._initArgs.restartMessage) {
			self.restart();
		} else if (message === self._initArgs.onlineMessage) {
			self.emit("workerOnline");
			
			return cb(null);
		}
	});
	
	self.emit("workerStarting");
}

Cluster.prototype.addServer = function(server) {
	var self = this;
	
	self._servers.push(server);
}

Cluster.prototype.online = function() {
	var self = this;
	
	self._process.send(self._initArgs.onlineMessage);
}

Cluster.prototype.restart = function() {
	var self = this;
	
	if (self._cluster.isMaster) {
		var currentWorkers = Object.keys(self._cluster.workers);
		
		// start new workers
		self._initWorkers(function() {
			// shutdown existing workers
			currentWorkers.forEach(function(id) {
				self._cluster.workers[id].send(self._initArgs.shutdownMessage);
			});
		});
	} else {
		self._process.send(self._initArgs.restartMessage);
	}
}

module.exports = new Cluster();