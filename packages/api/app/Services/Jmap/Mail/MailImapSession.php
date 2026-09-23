<?php

declare(strict_types=1);

namespace App\Services\Jmap\Mail;

use App\Services\Jmap\JmapMethodException;
use App\Services\Mail\MailCredentialService;
use App\Services\Mail\MailImapClient;
use App\Services\Mail\MailUserRuntime;
use IMAP\Connection;

/**
 * Request-scoped IMAP session per mail account. Mixed-mailbox batches reuse
 * this connection with sequential SELECT / imap_reopen (decision-doc cut #3).
 */
final class MailImapSession
{
    /** @var array<string, array{conn: Connection, selected: string, cred: array{displayName: string, emailAddress: string, mailAccountId: string, imap: array{host: string, port: int, security: string, username: string, password: string}, smtp: array{host: string, port: int, security: string, username: string, password: string}}}> */
    private array $accounts = [];

    public function __construct(private MailCredentialService $credentials) {}

    /**
     * @return array{displayName: string, emailAddress: string, mailAccountId: string, imap: array{host: string, port: int, security: string, username: string, password: string}, smtp: array{host: string, port: int, security: string, username: string, password: string}}
     */
    public function runtime(string $username, string $mailAccountId = MailIdCodec::ACCOUNT_PRIMARY): array
    {
        $this->connection($username, $mailAccountId);

        return $this->accounts[$this->key($username, $mailAccountId)]['cred'];
    }

    public function connection(string $username, string $mailAccountId = MailIdCodec::ACCOUNT_PRIMARY): Connection
    {
        $key = $this->key($username, $mailAccountId);
        if (! isset($this->accounts[$key])) {
            $cred = MailUserRuntime::resolve($username, $this->credentials);
            if ($cred === null || $cred['mailAccountId'] !== $mailAccountId) {
                throw new JmapMethodException('serverFail', 'Mailbox is not configured for this user.');
            }
            $err = null;
            $conn = MailImapClient::connect($cred['imap'], $err);
            if ($conn === null) {
                throw new JmapMethodException('serverFail', $err ?? 'imap_connect failed');
            }
            $this->accounts[$key] = [
                'conn' => $conn,
                'selected' => 'INBOX',
                'cred' => $cred,
            ];
        }

        return $this->accounts[$key]['conn'];
    }

    public function select(string $username, string $mailbox, string $mailAccountId = MailIdCodec::ACCOUNT_PRIMARY): Connection
    {
        $conn = $this->connection($username, $mailAccountId);
        $key = $this->key($username, $mailAccountId);
        if ($this->accounts[$key]['selected'] === $mailbox) {
            return $conn;
        }
        $ref = MailImapClient::mailboxRef($this->accounts[$key]['cred']['imap']);
        if (! MailImapClient::reopenMailbox($conn, $ref, $mailbox)) {
            throw new JmapMethodException('invalidArguments', 'Could not open mailbox.');
        }
        $this->accounts[$key]['selected'] = $mailbox;

        return $conn;
    }

    public function mailboxRef(string $username, string $mailAccountId = MailIdCodec::ACCOUNT_PRIMARY): string
    {
        $this->connection($username, $mailAccountId);

        return MailImapClient::mailboxRef($this->accounts[$this->key($username, $mailAccountId)]['cred']['imap']);
    }

    public function close(): void
    {
        foreach ($this->accounts as $row) {
            @imap_close($row['conn']);
        }
        $this->accounts = [];
    }

    private function key(string $username, string $mailAccountId): string
    {
        return strtolower(trim($username))."\0".$mailAccountId;
    }
}
