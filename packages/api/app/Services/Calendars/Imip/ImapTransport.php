<?php

declare(strict_types=1);

namespace App\Services\Calendars\Imip;

/**
 * Byte stream to one IMAP server. The socket implementation is
 * {@see ImapSocketTransport}; tests script a fake.
 */
interface ImapTransport
{
    /** @throws ImapException */
    public function open(ImapEndpoint $endpoint): void;

    /** Upgrade the open plain connection to TLS (STARTTLS). @throws ImapException */
    public function startTls(): void;

    /** @throws ImapException */
    public function write(string $bytes): void;

    /** One line including its CRLF, at most $maxBytes long. @throws ImapException */
    public function readLine(int $maxBytes): string;

    /** Exactly $length bytes. @throws ImapException */
    public function read(int $length): string;

    public function close(): void;
}
