FROM debian:bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends dovecot-imapd dovecot-core ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && useradd -u 1000 -U -d /var/mail -s /usr/sbin/nologin vmail \
  && mkdir -p /var/mail /var/run/dovecot \
  && chown vmail:vmail /var/mail

COPY dovecot.conf /etc/dovecot/dovecot.conf
COPY users /etc/dovecot/users
COPY seed /seed
COPY entrypoint.sh /entrypoint.sh
RUN chmod 644 /etc/dovecot/users /etc/dovecot/dovecot.conf \
  && chmod +x /entrypoint.sh

EXPOSE 143

HEALTHCHECK --interval=3s --timeout=3s --retries=20 --start-period=5s \
  CMD doveadm service status 2>/dev/null | grep -q imap || exit 1

CMD ["/entrypoint.sh"]
