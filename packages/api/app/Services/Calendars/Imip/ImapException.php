<?php

declare(strict_types=1);

namespace App\Services\Calendars\Imip;

/**
 * A mailbox could not be read. `errorCode` is what the settings show; the
 * message is for logs and never holds the password.
 */
final class ImapException extends \RuntimeException
{
    public const CONNECT_FAILED = 'connect_failed';

    public const TLS_FAILED = 'tls_failed';

    public const AUTH_FAILED = 'auth_failed';

    public const FOLDER_MISSING = 'folder_missing';

    public const HOST_NOT_ALLOWED = 'host_not_allowed';

    public const PROTOCOL_ERROR = 'protocol_error';

    public function __construct(public readonly string $errorCode, string $message)
    {
        parent::__construct($message);
    }
}
