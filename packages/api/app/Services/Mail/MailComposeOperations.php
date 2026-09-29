<?php

declare(strict_types=1);

namespace App\Services\Mail;

use PHPMailer\PHPMailer\PHPMailer;

final class MailComposeOperations
{
    public function __construct(
        private MailCredentialService $credentials,
        private MailImapGate $imap,
        private MailFolderOperations $folders,
    ) {}

    private function attachDecodedUploads(PHPMailer $mail, mixed $attachments): array
    {
        if (! is_array($attachments)) {
            return ['attached' => 0, 'skipped' => 0, 'totalBytes' => 0];
        }
        $maxFiles = 24;
        $maxPerFile = 15 * 1024 * 1024;
        $maxTotal = 40 * 1024 * 1024;
        $total = 0;
        $n = 0;
        $skipped = 0;
        foreach ($attachments as $a) {
            if ($n >= $maxFiles) {
                break;
            }
            if (! is_array($a)) {
                $skipped++;

                continue;
            }
            $name = isset($a['filename']) && is_string($a['filename']) ? $a['filename'] : 'attachment';
            $name = basename(str_replace(["\0", '\\'], '/', $name));
            if ($name === '' || $name === '.' || $name === '..') {
                $name = 'attachment';
            }
            $mime = isset($a['mimeType']) && is_string($a['mimeType']) && $a['mimeType'] !== ''
                ? $a['mimeType']
                : 'application/octet-stream';
            $b64 = isset($a['contentBase64']) && is_string($a['contentBase64'])
                ? preg_replace('/\s+/', '', $a['contentBase64'])
                : '';
            if (! is_string($b64) || $b64 === '') {
                $skipped++;

                continue;
            }
            $raw = base64_decode($b64, true);
            if ($raw === false || $raw === '') {
                $skipped++;

                continue;
            }
            $len = strlen($raw);
            if ($len > $maxPerFile || $total + $len > $maxTotal) {
                $skipped++;

                continue;
            }
            $total += $len;
            $mail->addStringAttachment($raw, $name, PHPMailer::ENCODING_BASE64, $mime);
            $n++;
        }

        return ['attached' => $n, 'skipped' => $skipped, 'totalBytes' => $total];
    }

    /**
     * Shared SMTP client configuration for building RFC822 via {@see PHPMailer::preSend()} (and for sending).
     *
     * @param  array{displayName: string, emailAddress: string, imap: array, smtp: array}  $cred
     * @return string Envelope From address used in {@see PHPMailer::setFrom()}
     */
    private function configureMailerSmtp(PHPMailer $mail, array $cred, int $smtpTimeout = 30): string
    {
        $transport = MailSmtpTransportConfig::normalize($cred['smtp']);
        $mail->CharSet = PHPMailer::CHARSET_UTF8;
        $mail->isSMTP();
        // Defaults are 300s each — wrong host/firewall makes POST hang until the browser gives up.
        $mail->Timeout = $smtpTimeout;
        $mail->getSMTPInstance()->Timelimit = $smtpTimeout;
        $mail->Host = $transport['host'];
        $mail->Port = $transport['port'];
        if ($transport['security'] === 'ssl') {
            $mail->SMTPSecure = PHPMailer::ENCRYPTION_SMTPS;
        } elseif ($transport['security'] === 'starttls') {
            $mail->SMTPSecure = PHPMailer::ENCRYPTION_STARTTLS;
        } else {
            $mail->SMTPAutoTLS = false;
            $mail->SMTPSecure = '';
        }
        $mail->SMTPAuth = $transport['smtpAuth'];
        $mail->SMTPKeepAlive = false;
        $mail->Username = $cred['smtp']['username'];
        $mail->Password = $cred['smtp']['password'];
        if (! config('wgw.mail.smtp_verify_tls', true)) {
            $mail->SMTPOptions = [
                'ssl' => [
                    'verify_peer' => false,
                    'verify_peer_name' => false,
                    'allow_self_signed' => true,
                ],
            ];
        }
        $fromAddr = MailFromAddressResolver::resolve($cred);
        $mail->setFrom($fromAddr, $cred['displayName'] ?: '');

        return $fromAddr;
    }

    public function handleSend(string $username, array $j): array
    {
        $cred = MailUserRuntime::resolve($username, $this->credentials);
        if ($cred === null) {
            throw new MailResponseException(400, ['error' => 'smtp_not_configured']);
        }

        $to = trim((string) ($j['to'] ?? ''));
        $subject = trim((string) ($j['subject'] ?? ''));
        $body = (string) ($j['body'] ?? '');
        $cc = trim((string) ($j['cc'] ?? ''));
        $bcc = trim((string) ($j['bcc'] ?? ''));
        if ($to === '') {
            throw new MailResponseException(400, ['error' => 'to_required']);
        }
        $smtpTimeout = 30;
        $transport = MailSmtpTransportConfig::normalize($cred['smtp']);
        $appendErr = null;
        $attachReport = null;
        try {
            if (! MailSmtpTransportConfig::canReachTcp($transport['host'], $transport['port'], 5.0)) {
                throw new \RuntimeException(
                    'Cannot reach SMTP server at '.MailSmtpTransportConfig::describe($transport)
                    .'. Check Admin mail settings (host, port, security) and that PHP can reach the host.'
                );
            }
            @set_time_limit($smtpTimeout + 30);
            $mail = new PHPMailer(true);
            self::configureMailerSmtp($mail, $cred, $smtpTimeout);
            foreach (preg_split('/[,;]/', $to) ?: [] as $addr) {
                $addr = trim($addr);
                if ($addr !== '') {
                    $mail->addAddress($addr);
                }
            }
            if ($cc !== '') {
                foreach (preg_split('/[,;]/', $cc) ?: [] as $addr) {
                    $addr = trim($addr);
                    if ($addr !== '') {
                        $mail->addCC($addr);
                    }
                }
            }
            if ($bcc !== '') {
                foreach (preg_split('/[,;]/', $bcc) ?: [] as $addr) {
                    $addr = trim($addr);
                    if ($addr !== '') {
                        $mail->addBCC($addr);
                    }
                }
            }
            $mail->Subject = $subject !== '' ? $subject : '(no subject)';
            $mail->Body = $body;
            $mail->isHTML(false);
            $attachReport = self::attachDecodedUploads($mail, $j['attachments'] ?? null);
            if (! $mail->preSend()) {
                throw new \RuntimeException($mail->ErrorInfo);
            }
            $sentMime = $mail->getSentMIMEMessage();
            if (! $mail->postSend()) {
                throw new \RuntimeException($mail->ErrorInfo);
            }
            $this->folders->tryAppendSentCopy($cred, $sentMime, $appendErr);
        } catch (\Throwable $e) {
            throw $this->mailSendException($e, $transport);
        }
        $payload = ['ok' => true];
        if ($attachReport !== null) {
            $payload['attachment_report'] = $attachReport;
        }
        if ($appendErr !== null) {
            $payload['sent_copy_failed'] = $appendErr;
        }

        return $payload;
    }

    /**
     * Build RFC822 from the composer and append it to the account’s Drafts mailbox (IMAP {@code APPEND}).
     */
    public function handleSaveDraft(string $username, array $j): array
    {
        $cred = $this->imap->requireImap($username);

        $to = trim((string) ($j['to'] ?? ''));
        $subject = trim((string) ($j['subject'] ?? ''));
        $body = (string) ($j['body'] ?? '');
        $cc = trim((string) ($j['cc'] ?? ''));
        $bcc = trim((string) ($j['bcc'] ?? ''));
        $smtpTimeout = 30;
        $appendErr = null;
        $attachReport = null;
        try {
            @set_time_limit($smtpTimeout + 30);
            $mail = new PHPMailer(true);
            $fromAddr = self::configureMailerSmtp($mail, $cred, $smtpTimeout);
            foreach (preg_split('/[,;]/', $to) ?: [] as $addr) {
                $addr = trim($addr);
                if ($addr !== '') {
                    $mail->addAddress($addr);
                }
            }
            if ($cc !== '') {
                foreach (preg_split('/[,;]/', $cc) ?: [] as $addr) {
                    $addr = trim($addr);
                    if ($addr !== '') {
                        $mail->addCC($addr);
                    }
                }
            }
            if ($bcc !== '') {
                foreach (preg_split('/[,;]/', $bcc) ?: [] as $addr) {
                    $addr = trim($addr);
                    if ($addr !== '') {
                        $mail->addBCC($addr);
                    }
                }
            }
            if (
                count($mail->getToAddresses()) + count($mail->getCcAddresses()) + count($mail->getBccAddresses()) < 1
            ) {
                // PHPMailer requires at least one recipient for preSend(); Bcc is omitted from SMTP MIME headers.
                $mail->addBCC($fromAddr);
            }
            $mail->AllowEmpty = true;
            $mail->Subject = $subject !== '' ? $subject : '(no subject)';
            $mail->Body = $body;
            $mail->isHTML(false);
            $attachReport = self::attachDecodedUploads($mail, $j['attachments'] ?? null);
            if (! $mail->preSend()) {
                throw new \RuntimeException($mail->ErrorInfo);
            }
            $mime = $mail->getSentMIMEMessage();
            $this->folders->tryAppendRfc822ToSystemFolder($cred, $mime, 'drafts', '\\Draft', $appendErr);
        } catch (\Throwable $e) {
            throw new MailResponseException(400, ['error' => 'draft_failed', 'message' => $e->getMessage()]);
        }
        if ($appendErr !== null) {
            throw new MailResponseException(400, ['error' => 'draft_append_failed', 'message' => $appendErr]);
        }
        $payload = ['ok' => true];
        if ($attachReport !== null) {
            $payload['attachment_report'] = $attachReport;
        }

        return $payload;
    }

    private function mailSendException(\Throwable $e, ?array $transport = null): MailResponseException
    {
        $message = trim($e->getMessage());
        if ($message === 'invalid_from_address') {
            return new MailResponseException(400, [
                'error' => 'invalid_from_address',
                'message' => 'Set a valid email on your account (Settings or Admin) or use a full email address as your mail login.',
            ]);
        }

        $endpoint = $transport !== null ? MailSmtpTransportConfig::describe($transport) : '';
        $connectFailed = stripos($message, 'Could not connect') !== false
            || stripos($message, 'Failed to connect') !== false
            || stripos($message, 'Cannot reach SMTP') !== false;

        if ($connectFailed && $endpoint !== '') {
            return new MailResponseException(400, [
                'error' => 'smtp_connect',
                'message' => $message !== ''
                    ? $message.' (configured: '.$endpoint.')'
                    : 'Could not connect to SMTP server at '.$endpoint.'.',
                'smtp' => [
                    'host' => $transport['host'],
                    'port' => $transport['port'],
                    'security' => $transport['security'],
                ],
            ]);
        }

        return new MailResponseException(400, [
            'error' => 'send_failed',
            'message' => $message !== '' ? $message : 'SMTP send failed.',
        ]);
    }
}
