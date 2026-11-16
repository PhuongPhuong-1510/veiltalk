# VeilTalk production log retention

This is a Linux host template for the approved **Docker syslog + host logrotate** option. It does not change the development stack unless `docker-compose.logging.yml` is added to the Compose command.

1. Create `/var/log/veiltalk` owned by root with mode `0750`. Install `30-veiltalk.conf` in `/etc/rsyslog.d/` and `veiltalk.logrotate` in `/etc/logrotate.d/`; reload rsyslog and ensure the host runs logrotate daily. Rotation retains at most 29 rotated daily files plus the current file, keeping the operational log period within 30 days when the daily job runs.
2. Start the production stack using both Compose files. Docker's syslog driver routes all seven service logs to host rsyslog instead of retaining unbounded json-file logs.
3. Verify that a unique harmless sentinel emitted by each service appears in `runtime.log`, check nginx access lines contain `$uri` without query strings, run `logrotate -d /etc/logrotate.d/veiltalk`, and check rotated file ages. Repeat on the actual production-equivalent host before marking T06 LOG-010 PASS.

The overlay replaces nginx's stock `nginx.conf` so its default `$request` access format cannot log query strings alongside the safe format. It still includes existing `/etc/nginx/conf.d/*.conf` routes. The access format deliberately omits query strings and request/Authorization headers. Backend and signaling log contents still require secret and personal-data scanning because no generic log collector can guarantee application-level redaction. Access to `runtime.log` should be limited to operators. A separate security audit log needs its own retention decision and is outside this 30-day operational log policy.
