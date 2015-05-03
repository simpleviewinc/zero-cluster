var clustering = require("../index.js");
var cluster = require("cluster");
var express = require("express");
var fs = require("fs");

var broadcast = function(data) {
	process.send(data);
}

var clusteringEvents = ["workerStarting", "workerOnline", "workersOnline", "workersOnlineInitial", "shutdown", "workerShutdown"];

clusteringEvents.forEach(function(val, i) {
	clustering.on(val, function() {
		broadcast({ event : val });
	});
});

process.on("message", function(data) {
	if (data.event === "getWorkerIds") {
		process.send({
			event : "getWorkerIds",
			data : Object.keys(cluster.workers)
		});
	}
});

clustering.init({
	numWorkers : process.env.numWorkers ? parseInt(process.env.numWorkers) : undefined,
	master : function(cb) {
		broadcast({ event : "masterCalled" });
		
		fs.unlink(process.env.socket, function() {
			cb(null);
		});
	},
	worker : function(cb) {
		broadcast({ event : "workerCalled" });
		
		var app = express();
		
		if (process.env.failBoot === "true") {
			throw new Error("fail on boot");
		}
		
		app.get("/simple/", function(req, res) {
			res.send("done " + cluster.worker.id);
		});
		
		app.get("/exit/", function(req, res) {
			process.exit(req.query.code);
		});
		
		app.get("/slow/", function(req, res) {
			setTimeout(function() {
				res.send("done " + cluster.worker.id);
			}, 10000);
		});
		
		app.get("/restart/", function(req, res) {
			clustering.restart();
			
			res.send("restarting");
		});
		
		var server = app.listen(process.env.socket, function(err) {
			if (err) { throw err; }
			
			clustering.addServer(server);
			
			clustering.online();
		});
	}
});