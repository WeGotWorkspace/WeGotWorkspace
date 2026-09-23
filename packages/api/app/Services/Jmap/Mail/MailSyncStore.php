<?php

declare(strict_types=1);

namespace App\Services\Jmap\Mail;

use App\Models\JmapMailMessage;
use App\Models\JmapMailSync;
use App\Services\Mail\MailImapClient;
use IMAP\Connection;

/**
 * Local IMAP sync-cache (decision doc §1). Flag diffs only cover a recent
 * UID window (cut #1). UIDVALIDITY change → cannotCalculateChanges.
 */
final class MailSyncStore
{
    public const FLAG_WINDOW = 500;

    /**
     * @return array<string, array{uidvalidity: int, uidnext: int, window: string}>
     */
    public function snapshot(string $username, string $mailAccountId): array
    {
        $rows = JmapMailSync::query()
            ->where('username', $username)
            ->where('mail_account_id', $mailAccountId)
            ->get();
        $out = [];
        foreach ($rows as $row) {
            $out[(string) $row->mailbox] = [
                'uidvalidity' => (int) $row->uidvalidity,
                'uidnext' => (int) $row->last_seen_uidnext,
                'window' => (string) $row->window_flags_hash,
            ];
        }

        return $out;
    }

    /**
     * Refresh one mailbox from live IMAP into the cache.
     *
     * When `$sinceSnapshot` is set (Email/changes), created/updated are
     * computed against that sinceState — not against the cache, which other
     * methods in the same session may already have healed.
     *
     * @param  array<string, array{uidvalidity: int, uidnext: int, window: string}>|null  $sinceSnapshot
     * @return array{uidvalidity: int, uidnext: int, window: string, created: list<int>, destroyed: list<int>, updated: list<int>}
     */
    public function syncMailbox(
        string $username,
        string $mailAccountId,
        string $mailbox,
        Connection $conn,
        string $ref,
        ?array $sinceSnapshot = null,
    ): array {
        $status = MailImapClient::mailboxStatus($conn, $ref, $mailbox);
        if ($status === null) {
            $status = ['uidvalidity' => 0, 'uidnext' => 0, 'unseen' => 0, 'messages' => 0];
        }

        $existing = JmapMailSync::query()
            ->where('username', $username)
            ->where('mail_account_id', $mailAccountId)
            ->where('mailbox', $mailbox)
            ->first();

        $created = [];
        $destroyed = [];
        $updated = [];

        $cachedUids = JmapMailMessage::query()
            ->where('username', $username)
            ->where('mail_account_id', $mailAccountId)
            ->where('mailbox', $mailbox)
            ->pluck('uid', 'uid')
            ->all();
        $cachedUids = array_map('intval', array_keys($cachedUids));

        if ($existing !== null && (int) $existing->uidvalidity !== 0
            && (int) $existing->uidvalidity !== (int) $status['uidvalidity']) {
            JmapMailMessage::query()
                ->where('username', $username)
                ->where('mail_account_id', $mailAccountId)
                ->where('mailbox', $mailbox)
                ->delete();
            $cachedUids = [];
        }

        $page = MailImapClient::sortUidsNewestFirstPaged(
            $conn,
            $ref,
            $mailbox,
            self::FLAG_WINDOW,
            0,
            self::FLAG_WINDOW,
        );
        $liveWindow = $page['uids'];
        $overviews = MailImapClient::fetchOverviews($conn, $liveWindow);
        $liveSet = [];
        $windowParts = [];
        foreach ($overviews as $ov) {
            if (! is_object($ov)) {
                continue;
            }
            $uid = (int) ($ov->uid ?? 0);
            if ($uid <= 0) {
                continue;
            }
            $liveSet[$uid] = true;
            $flags = $this->flagsHash($ov);
            $windowParts[] = $uid.':'.$flags;
            $headers = $this->headerBits($ov);
            $threadKey = MailThreadKey::fromHeaders(
                $headers['messageId'],
                $headers['inReplyTo'],
                $headers['references'],
                (string) ($ov->subject ?? ''),
                (string) ($ov->from ?? ''),
            );
            $was = JmapMailMessage::query()
                ->where('username', $username)
                ->where('mail_account_id', $mailAccountId)
                ->where('mailbox', $mailbox)
                ->where('uid', $uid)
                ->first();
            if ($was === null) {
                $created[] = $uid;
            } elseif ((string) $was->flags_hash !== $flags) {
                $updated[] = $uid;
            }
            JmapMailMessage::query()->updateOrInsert(
                [
                    'username' => $username,
                    'mail_account_id' => $mailAccountId,
                    'mailbox' => $mailbox,
                    'uid' => $uid,
                ],
                [
                    'flags_hash' => $flags,
                    'message_id_hash' => hash('sha256', $headers['messageId']),
                    'thread_key' => $threadKey,
                    'internaldate' => isset($ov->internaldate) ? (string) $ov->internaldate : null,
                ],
            );
        }

        foreach ($cachedUids as $uid) {
            if ($uid >= (int) $status['uidnext']) {
                continue;
            }
            if (! isset($liveSet[$uid]) && in_array($uid, $liveWindow, true)) {
                $destroyed[] = $uid;
                JmapMailMessage::query()
                    ->where('username', $username)
                    ->where('mail_account_id', $mailAccountId)
                    ->where('mailbox', $mailbox)
                    ->where('uid', $uid)
                    ->delete();
            }
        }

        // UIDs newer than cached uidnext and not in the windowed fetch still count as created.
        $prevNext = $existing !== null ? (int) $existing->last_seen_uidnext : 0;
        foreach ($liveWindow as $uid) {
            if ($prevNext > 0 && $uid >= $prevNext && ! in_array($uid, $created, true)) {
                $created[] = $uid;
            }
        }

        $windowHash = hash('sha256', implode('|', $windowParts));
        if ($sinceSnapshot !== null) {
            [$created, $updated] = $this->deltaVersusSince($mailbox, $sinceSnapshot, $liveWindow, $windowHash);
        }
        JmapMailSync::query()->updateOrInsert(
            [
                'username' => $username,
                'mail_account_id' => $mailAccountId,
                'mailbox' => $mailbox,
            ],
            [
                'uidvalidity' => (int) $status['uidvalidity'],
                'last_seen_uidnext' => (int) $status['uidnext'],
                'window_flags_hash' => $windowHash,
                'updated_at' => now()->toDateTimeString(),
            ],
        );

        return [
            'uidvalidity' => (int) $status['uidvalidity'],
            'uidnext' => (int) $status['uidnext'],
            'window' => $windowHash,
            'created' => array_values(array_unique($created)),
            'destroyed' => array_values(array_unique($destroyed)),
            'updated' => array_values(array_unique($updated)),
        ];
    }

    /**
     * @return list<array{uid: int, thread_key: string, flags_hash: string}>
     */
    public function messagesForThread(string $username, string $mailAccountId, string $threadKey): array
    {
        $rows = JmapMailMessage::query()
            ->where('username', $username)
            ->where('mail_account_id', $mailAccountId)
            ->where('thread_key', $threadKey)
            ->get();
        $out = [];
        foreach ($rows as $row) {
            $out[] = [
                'uid' => (int) $row->uid,
                'mailbox' => (string) $row->mailbox,
                'thread_key' => (string) $row->thread_key,
                'flags_hash' => (string) $row->flags_hash,
            ];
        }

        return $out;
    }

    public function threadKeyFor(string $username, string $mailAccountId, string $mailbox, int $uid): ?string
    {
        $row = JmapMailMessage::query()
            ->where('username', $username)
            ->where('mail_account_id', $mailAccountId)
            ->where('mailbox', $mailbox)
            ->where('uid', $uid)
            ->first();

        return $row !== null ? (string) $row->thread_key : null;
    }

    /**
     * @param  array<string, array{uidvalidity: int, uidnext: int, window: string}>  $sinceSnapshot
     * @param  list<int>  $liveWindow
     * @return array{0: list<int>, 1: list<int>}
     */
    private function deltaVersusSince(
        string $mailbox,
        array $sinceSnapshot,
        array $liveWindow,
        string $windowHash,
    ): array {
        if (! array_key_exists($mailbox, $sinceSnapshot)) {
            return [array_values(array_unique($liveWindow)), []];
        }
        $prevNext = (int) $sinceSnapshot[$mailbox]['uidnext'];
        $sinceWindow = (string) $sinceSnapshot[$mailbox]['window'];
        $created = [];
        $updated = [];
        foreach ($liveWindow as $uid) {
            if ($uid >= $prevNext) {
                $created[] = $uid;

                continue;
            }
            if ($sinceWindow !== $windowHash) {
                $updated[] = $uid;
            }
        }

        return [array_values(array_unique($created)), array_values(array_unique($updated))];
    }

    private function flagsHash(object $ov): string
    {
        $seen = ! empty($ov->seen);
        $flagged = ! empty($ov->flagged);
        $answered = ! empty($ov->answered);
        $draft = ! empty($ov->draft);

        return ($seen ? 'S' : '-').($flagged ? 'F' : '-').($answered ? 'A' : '-').($draft ? 'D' : '-');
    }

    /**
     * @return array{messageId: string, inReplyTo: string, references: string}
     */
    private function headerBits(object $ov): array
    {
        return [
            'messageId' => trim((string) ($ov->message_id ?? '')),
            'inReplyTo' => trim((string) ($ov->in_reply_to ?? '')),
            'references' => trim((string) ($ov->references ?? '')),
        ];
    }
}
