pipe-to-syslog
===========

Simple NodeJS daemon to perform ***tail -f*** on one or more log files and stream them to a specific remote syslog server over TCP. Useful for instances where a program can not be conveniently rebuilt to use syslog.

Check out the announcement for more detail: http://engineering.hipmob.com/2012/10/12/Unified-logging-with-Node-JS-and-Syslog/

### Configuration

<div>
1. Check out the <code>pipe-to-syslog</code> project from Github and copy the configuration template
<pre class="brush: bash">
git clone https://github.com/Hipmob/pipe-to-syslog.git /var/local/pipe-to-syslog
cd /var/local/pipe-to-syslog
</pre>
2. Install all the dependencies.
<pre class="brush: bash">
npm install
</pre>
3. Add it to Upstart.
<pre class="brush: bash">
cp pipe-to-syslog.conf /etc/init
</pre>
4. By default we drop privileges and run as a user other than root, so create that user and group here.
<pre class="brush: bash">
useradd -M --shell /bin/false node
</pre>
<span class="label label-info">NOTE</span> If you don't create this user and group, you will need to edit the <code>/etc/init/pipe-to-syslog.conf</code> file to remove the <code>--user</code> and <code>--group</code> parameters.<br /><br />
5. Create the local log file folder.
<pre class="brush: bash">
mkdir /var/log/node
</pre>
<span class="label label-info">NOTE</span> If you don't create this folder the service will not start. If you want to log to a different location edit the <code>/etc/init/pipe-to-syslog.conf</code> file.<br /><br />
6. Setup the configuration file.
<pre class="brush: bash">
cp conf.js.template conf.js
</pre>

Edit conf.js: we've tried to keep it pretty simple. You can have as many unique entries in the <code>self</code> object. For each entry, you can specify an arbitrary number of **sinks**, where each sink describes the source **channel** (in this case, a file that should be tailed) and the syslog level, facility and tag. For the entry you can specify the hostname to be sent to the syslog server (you'll need to make a note of this when you're configuring the syslog server), and then the actual syslog server IP address/DNS name and port number.

<pre class="brush: js">
function get_config()
{
    var self = {};
    self['web'] = {
        sinks: [
            {
                channel: { type: 'tail', file: '/var/log/node/out.log' },
                level: 'info',
                tag: 'web',
                facility: 'user',
            },
            {
                channel: { type: 'tail', file: '/var/log/node/err.log' },
                level: 'error',
                tag: 'web',
                facility: 'user',
            }],
        hostname: '{hostname}',
        server: '{syslog server IP address or DNS name}',
        port: {port number} };
    return self;
}

module.exports.get_config = get_config;
</pre>
7. And, you're done. Start it up.
<pre class="brush: bash">
service pipe-to-syslog start
</pre>
</div>