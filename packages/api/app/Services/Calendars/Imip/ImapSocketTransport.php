<?php

declare(strict_types=1);

namespace App\Services\Calendars\Imip;

/**
 * Plain PHP stream socket: no ext-imap. Connects to the checked IP and
 * verifies the certificate against the host name, so a DNS change between
 * the check and the connect cannot redirect the login.
 */
final class ImapSocketTransport implements ImapTransport
{
    public const CONNECT_TIMEOUT_SECONDS = 10;

    /** Wall-clock budget from sending a command until its reply is read. */
    public const READ_TIMEOUT_SECONDS = 20;

    private float $deadline = 0.0;

    public function __construct(private readonly float $commandSeconds = self::READ_TIMEOUT_SECONDS) {}

    /** @var resource|null */
    private $stream = null;

    public function open(ImapEndpoint $endpoint): void
    {
        $address = str_contains($endpoint->connectIp, ':')
            ? '['.$endpoint->connectIp.']'
            : $endpoint->connectIp;
        $context = stream_context_create(['ssl' => $this->sslOptions($endpoint)]);
        $errno = 0;
        $errstr = '';
        $stream = @stream_socket_client(
            'tcp://'.$address.':'.$endpoint->port,
            $errno,
            $errstr,
            self::CONNECT_TIMEOUT_SECONDS,
            STREAM_CLIENT_CONNECT,
            $context,
        );
        if (! is_resource($stream)) {
            throw new ImapException(ImapException::CONNECT_FAILED, 'Could not connect to the mail server.');
        }
        $this->stream = $stream;
        $this->deadline = microtime(true) + $this->commandSeconds;
        if ($endpoint->security === ImapEndpoint::SECURITY_SSL) {
            $this->startTls();
        }
    }

    public function startTls(): void
    {
        $stream = $this->requireStream();
        $ok = @stream_socket_enable_crypto(
            $stream,
            true,
            STREAM_CRYPTO_METHOD_TLSv1_2_CLIENT | STREAM_CRYPTO_METHOD_TLSv1_3_CLIENT,
        );
        if ($ok !== true) {
            $this->close();

            throw new ImapException(ImapException::TLS_FAILED, 'The TLS handshake with the mail server failed.');
        }
    }

    public function write(string $bytes): void
    {
        $stream = $this->requireStream();
        $this->deadline = microtime(true) + $this->commandSeconds;
        $length = strlen($bytes);
        $written = 0;
        while ($written < $length) {
            $chunk = @fwrite($stream, substr($bytes, $written));
            if ($chunk === false || $chunk === 0) {
                $this->failRead('Could not write to the mail server.');
            }
            $written += $chunk;
        }
    }

    public function readLine(int $maxBytes): string
    {
        $stream = $this->armTimeout();
        $line = @fgets($stream, max(1, $maxBytes) + 1);
        if ($line === false) {
            $this->failRead('The mail server closed the connection.');
        }
        if (! str_ends_with($line, "\n")) {
            if (strlen($line) >= $maxBytes) {
                throw new ImapException(ImapException::PROTOCOL_ERROR, 'The mail server sent a line that is too long.');
            }
            $this->failRead('The mail server closed the connection.');
        }

        return $line;
    }

    public function read(int $length): string
    {
        $buffer = '';
        while (strlen($buffer) < $length) {
            $stream = $this->armTimeout();
            $chunk = @fread($stream, max(1, min(65536, $length - strlen($buffer))));
            if ($chunk === false || $chunk === '') {
                $this->failRead('The mail server closed the connection.');
            }
            $buffer .= $chunk;
        }

        return $buffer;
    }

    public function close(): void
    {
        if (is_resource($this->stream)) {
            @fclose($this->stream);
        }
        $this->stream = null;
    }

    /** @return array<string, mixed> */
    private function sslOptions(ImapEndpoint $endpoint): array
    {
        return [
            'peer_name' => $endpoint->host,
            'SNI_enabled' => true,
            'verify_peer' => $endpoint->verifyCertificate,
            'verify_peer_name' => $endpoint->verifyCertificate,
            'allow_self_signed' => ! $endpoint->verifyCertificate,
        ];
    }

    /** @return resource */
    private function requireStream()
    {
        if (! is_resource($this->stream)) {
            throw new ImapException(ImapException::CONNECT_FAILED, 'Not connected to the mail server.');
        }

        return $this->stream;
    }

    /**
     * Limit the next read to what is left of the command's deadline, so a
     * server that trickles lines cannot keep one command running.
     *
     * @return resource
     */
    private function armTimeout()
    {
        $stream = $this->requireStream();
        $remaining = $this->deadline - microtime(true);
        if ($remaining <= 0) {
            $this->close();

            throw new ImapException(ImapException::CONNECT_FAILED, 'The mail server did not answer in time.');
        }
        $seconds = (int) $remaining;
        stream_set_timeout($stream, $seconds, (int) (($remaining - $seconds) * 1_000_000));

        return $stream;
    }

    private function failRead(string $message): never
    {
        $stream = $this->stream;
        $timedOut = is_resource($stream) && stream_get_meta_data($stream)['timed_out'];
        $this->close();

        throw new ImapException(
            ImapException::CONNECT_FAILED,
            $timedOut ? 'The mail server did not answer in time.' : $message,
        );
    }
}
