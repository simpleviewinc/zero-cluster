var clustering = require("../index.js");
var child_process = require("child_process");
var events = require("events");
var assert = require("assert");
var request = require("request");
var async = require("async");

describe(__filename, function() {
	this.timeout(10000);
	
	var defaultSocket = "/tmp/test.socket";
	
	var spawnMaster = function(args) {
		args = args || {};
		var child = child_process.fork(__dirname + "/master.js", { env : { numWorkers : args.numWorkers, socket : defaultSocket } });
		var ee = new events.EventEmitter();
		child.on("message", function(message) {
			ee.emit(message.event, message.data);
		});
		
		return { ee : ee, child : child };
	}
	
	it("should init master and workers", function(done) {
		var result = spawnMaster({ numWorkers : 3 });
		
		var masterCalled = false;
		var workersOnline = false;
		var workerStarting = 0;
		var workerOnline = 0;
		
		result.ee.on("masterCalled", function() {
			masterCalled = true;
		});
		
		result.ee.on("workerStarting", function() {
			workerStarting++;
		});
		
		result.ee.on("workerOnline", function() {
			workerOnline++;
		});
	
	result.ee.on("workersOnline", function() {
			workersOnline = true;
	});
		
		result.ee.on("workersOnlineInitial", function() {
			result.child.send({ event : "getWorkerIds" });
		});
		
		result.ee.on("getWorkerIds", function(data) {
			assert.equal(masterCalled, true);
			assert.equal(workersOnline, true);
			assert.equal(workerStarting, 3);
			assert.equal(workerOnline, 3);
			assert.deepEqual(data, ["1", "2", "3"]);
			
			done();
		});
	});
	
	it("should revive dead worker", function(done) {
		var result = spawnMaster({ numWorkers : 1 });
		
		result.ee.on("workersOnlineInitial", function() {
			result.ee.on("workerOnline", function() {
				result.ee.on("getWorkerIds", function(data) {
					assert.deepEqual(data, ["2"]);
					
					done();
				});
				
				result.child.send({ event : "getWorkerIds" });
			});
			
			request.get("http://unix:" + defaultSocket + ":/exit/?code=1", function(err, resp, body) {
				// ignore error, it's expected
			});
		});
	});
	
	it("should not revive worker if code is in shutdownCodes", function(done) {
		var result = spawnMaster({ numWorkers : 2 });
		
		result.ee.on("workersOnlineInitial", function() {
			result.ee.on("workerShutdown", function() {
				result.ee.on("getWorkerIds", function(data) {
					assert.equal(data.length, 1);
					
					done();
				});
				
				result.child.send({ event : "getWorkerIds" });
			});
			
			request.get("http://unix:" + defaultSocket + ":/exit/?code=42", function(err, resp, body) {
				// ignore error, it's expected
			});
		});
	});
	
	it("should restart all workers without interruption", function(done) {
		this.timeout(30000);
		
		var result = spawnMaster({ numWorkers : 3 });
		
		result.ee.on("workersOnlineInitial", function() {
			var i1 = setInterval(function() {
				request.get("http://unix:" + defaultSocket + ":/simple/", function(err, resp, body) {
					assert.ifError(err);
					assert.equal(resp.statusCode, 200);
				});
			}, 5);
			
			async.parallel([
				function(cb) {
					request.get("http://unix:" + defaultSocket + ":/slow/", function(err, resp, body) {
						assert.ifError(err);
						// one of the original 3 workers should serve this request
						assert.ok(["done 1", "done 2", "done 3"].indexOf(body) > -1);
						
						return cb(null);
					});
				},
				function(cb) {
					var count = 0;
					result.ee.on("workerShutdown", function() {
						count++;
						
						if (count === 3) {
							clearInterval(i1);
							
							result.ee.on("getWorkerIds", function(data) {
								assert.deepEqual(data, ["4", "5", "6"]);
								
								return cb(null);
							});
							
							result.child.send({ event : "getWorkerIds" });
						}
					});
				},
				function(cb) {
					request.get("http://unix:" + defaultSocket + ":/restart/", cb);
				}
			], function(err) {
				assert.ifError(err);
				
				done();
			});
		});
	});
	
	it("should not continue to boot workers that fail in boot", function(done) {
		var result = spawnMaster({ numWorkers : 1, failBoot : true });
		
	});
});