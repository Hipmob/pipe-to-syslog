/*
 * Prerequisites:
 *
 * - node
 * - npm
 *
 *
 * Setup:
 *
 * git clone git@github.com/Hipmob/pipe-to-syslog /var/local/pipe-to-syslog
 * useradd -M --shell /bin/false node
 * mkdir /var/log/node
 * touch /var/log/node/pipe-to-syslog.out.log
 * touch /var/log/node/pipe-to-syslog.err.log
 * chown -R node:node 
 * cd /var/local/pipe-to-syslog
 * npm install
 * copy /var/local/pipe-to-syslog.conf.js.template /var/local/pipe-to-syslog/conf.js
 *
 * Configuration:
 *
 * Edit the configuration file /var/local/pipe-to-syslog/conf.js. 
 *
 * Running (on Ubuntu):

 * cp /var/local/pipe-to-syslog/pipe-to-syslog.conf /etc/init/pipe-to-syslog.conf
 * service pipe-to-syslog start 
 *
 * Dropping Privileges:
 * If the argument --user <username> is provided then 5 seconds after startup a setuid call will be made to switch the process to that user.
 * If the argument --group <groupname> is provided then 5 seconds after startup a setgid call will be made to switch the process to that group.
 *
 */
(function(){
    // built-ins
    var util = require('util');
    var net     = require('net');
    var spawn = require('child_process').spawn;
    var os = require("os");

    // external dependencies
    var carrier = require('carrier');

    // internal library (bug fixed from the node-syslog package)
    var syslog = require('./node-syslog.js');

    // load the configuration file
    var conf = require("./conf.js").get_config();

    /*
     * Translates a level string into a syslog value.
     */
    var get_level = function(source, sink)
    {
	var level = 'info';
	if('level' in sink) level = sink.level;
	else if('level' in source) level = source.level;
	
	if(level == 'emergency') return syslog.LOG_EMERG;
	else if(level == 'alert') return syslog.LOG_ALERT;
	else if(level == 'critical') return syslog.LOG_CRIT;
	else if(level == 'error') return syslog.LOG_ERROR;
	else if(level == 'warn') return syslog.LOG_WARNING;	
	else if(level == 'notice') return syslog.LOG_NOTICE;
	else if(level == 'debug') return syslog.LOG_DEBUG;		
	else return syslog.LOG_INFO;
    };

    var servers;
    var host = os.hostname();

    /* Sets up the system: 
     * 1. Reads each log source from the config blob. For each log source:
     *   a. Create a syslog client for it using the parameters in the source entry.
     *   b. Iterate over the sinks specified in the log source. These are either network ports or files:
     *      i.  For each network port, open a line-oriented server that accepts connections.
     *      ii. For each file, spawn a child process that runs `tail -n 0 -f` on the file.
     *
     * 2. As lines come in on a specific log source's sinks, forward them to the syslog server using the client.
     * 3. If a SIGUSR1 is received:
     *   a. Kill all the tail processes.
     *   b. Restart them (this is useful for log files that get rotated).
     * 4. If a SIGUSR2 is received:
     *   a. Shutdown all the network servers.
     *   b. Kill all the tail processes.
     *   c. Disconnect all the syslog clients.
     *   d. Reload the configuration file.
     *   e. Re-run the setup process (step 1 above).
     * 5. If a SIGTERM is received:
     *   a. Shutdown all the network servers.
     *   b. Kill all the tail processes.
     *   c. Disconnect all the syslog clients.
     *   d. Reload the configuration file.
     *   e. Exit.
     */
    var setup = function(){
	servers = {};
	var sinks, i, sourcename, source;
	for(sourcename in conf){
	    source = conf[sourcename];
	    var server = {};
	    server['name'] = sourcename;
	    server['source'] = source;
	    var hostname = host;
	    if('hostname' in source) hostname = source.hostname;
	    server['client'] = syslog.createClient(source.port, source.server, { hostname: hostname });
	    
	    sinks = [];
	    if('sinks' in source){
		for(i=0;i<source.sinks.length;i++){
		    (function(sink){
			if(sink.config.channel.type == 'socket'){
			    sink['listener'] = net.createServer(function(conn) {
				var my_carrier = carrier.carry(conn);
				my_carrier.on('line',  function(line){
				    //console.log('['+sink.config.level+"/"+sink.config.tag+"/"+sink.config.facility+'] ' + line);
				    server.client.log(line, sink.level);
				});
			    });
			    sink.listener.listen(sink.config.channel.port);
			}else if(sink.config.channel.type == "tail"){
			    sink['listener'] = spawn("tail", ["-n", "0", "-f", sink.config.channel.file]);
			    var my_carrier = carrier.carry(sink.listener.stdout);
			    my_carrier.on('line', function(line){
				//console.log('['+sink.config.level+"/"+sink.config.tag+"/"+sink.config.facility+'] ' + line);
				server.client.log(line, sink.level);
			    });
			}
			sinks.push(sink);
		    })({config: source.sinks[i], level: get_level(source, source.sinks[i]) });
		}
	    }else if('sink' in source){
		(function(sink){
		    if(sink.config.channel.type == 'socket'){
			sink['listener'] = net.createServer(function(conn) {
			    var my_carrier = carrier.carry(conn);
			    my_carrier.on('line',  function(line){
				//console.log('['+sink.config.level+"/"+sink.config.tag+"/"+sink.config.facility+'] ' + line);
				server.client.log(line, sink.level);
			    });
			});
			sink.listener.listen(sink.config.channel.port);
		    }else if(sink.config.channel.type == "tail"){
			sink['listener'] = spawn("tail", ["-n", "0", "-f", sink.config.channel.file]);
			var my_carrier = carrier.carry(sink.listener.stdout);
			my_carrier.on('line', function(line){
			    //console.log('['+sink.config.level+"/"+sink.config.tag+"/"+sink.config.facility+'] ' + line);
			    server.client.log(line, sink.level);
			});
		    }
		    sinks.push(sink);
		})({ config: source.sink, level: get_level(source, source.sink)});
	    }
	    server['sinks'] = sinks;
	    servers[sourcename] = server;
	}
    };
    
    var update_tails = function () {
	var tasks = [];
	for(sourcename in servers){
	    var server = servers[sourcename];
	    sinks = server['sinks'];
	    for(i=0;i<sinks.length;i++){
		if(sinks[i].config.channel.type == 'tail'){
		    (function(sink){
			sink.listener.kill();
			sink['listener'] = spawn("tail", ["-n", "0", "-f", sink.config.channel.file]);
			var my_carrier = carrier.carry(sink.listener.stdout);
			my_carrier.on('line', function(line){
			    //console.log('['+sink.config.level+"/"+sink.config.tag+"/"+sink.config.facility+'] ' + line);
			    server.client.log(line, sink.level);
			});
		    })(sinks[i]);
		}
	    }
	}	
    };

    var teardown = function () {
	var tasks = [];
	for(sourcename in servers){
	    var server = servers[sourcename];
	    sinks = server['sinks'];
	    for(i=0;i<sinks.length;i++){
		if(sinks[i].config.channel.type == 'socket'){
		    sinks[i].listener.close();
		}else if(sinks[i].config.channel.type == 'tail'){
		    //sinks[i].listener.on('exit', function(code){ console.log("DONE"); });
		    sinks[i].listener.kill();
		}
	    }
	    
	    // kill the client
	    server.client.shutdown();
	}
    };

    var reload_config = function()
    {
	teardown();
	conf = require("./conf.js").get_config();
	setup();
    };

    var drop_privileges = function(){
        var i, j = process.argv.length;
        if(j <= 2) return;
        var user = false, group = false;
        for(i=2;i<j;i++){
            if(process.argv[i] == '--user' && j > i+1){
                ++i;
                user = process.argv[i];
            }else if(process.argv[i] == '--group' && j > i+1){
                ++i;
                group = process.argv[i];
            }
        }
        if(group){ console.log("Switching group to ["+group+"]"); process.setgid(group); }
        if(user){ console.log("Switching user to ["+user+"]"); process.setuid(user); }
    };
    
    var shutdown = function()
    {
	teardown();
	process.removeListener('SIGUSR1', update_tails);
	process.removeListener('SIGUSR2', reload_config);
    };

    /*
     * Handles reloads (for tail).
     */
    process.on('SIGUSR1', update_tails);

    /*
     * Handles full config reloads.
     */
    process.on('SIGUSR2', reload_config);
    
    /*
     * Handles orderly exits.
     */
    process.on('SIGTERM', shutdown);
    
    // run the first setup.
    setup();
    
    console.log("Pipe-to-syslog is now running....");
    
    // drop privileges
    setTimeout(drop_privileges, 5000);
}());
