#!/bin/sh
set -eu
for user in bob@example.test alice@example.test; do
  home="/var/mail/${user}"
  mkdir -p "${home}/cur" "${home}/new" "${home}/tmp"
  if [ -d "/seed/${user}" ]; then
    cp -a "/seed/${user}/." "${home}/"
  fi
  chown -R vmail:vmail "${home}"
done
exec dovecot -c /etc/dovecot/dovecot.conf -F
