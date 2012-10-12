pipe-to-syslog
===========

Simple NodeJS daemon to perform ***tail -f*** on one or more log files and stream them to a specific remote syslog server over TCP. Useful for instances where a program can not be conveniently rebuilt to use syslog.