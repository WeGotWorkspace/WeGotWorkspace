<?php

declare(strict_types=1);

namespace App\Services\Jmap\Mail;

/**
 * Cached thread_key = hash of the normalized root of the References/In-Reply-To
 * chain, falling back to normalized subject + participants (decision doc §2).
 */
final class MailThreadKey
{
    public static function fromHeaders(
        string $messageId,
        string $inReplyTo,
        string $references,
        string $subject,
        string $from,
    ): string {
        $ids = self::messageIds($references.' '.$inReplyTo);
        $root = $ids[0] ?? '';
        if ($root === '') {
            $root = strtolower(trim($messageId));
        }
        if ($root !== '') {
            return hash('sha256', 'id:'.$root);
        }

        $subj = strtolower(trim(preg_replace('/^(re|fw|fwd)\s*:\s*/i', '', $subject) ?? $subject));
        $from = strtolower(trim($from));

        return hash('sha256', 'subj:'.$subj.'|'.$from);
    }

    /**
     * @return list<string>
     */
    private static function messageIds(string $raw): array
    {
        preg_match_all('/<[^>]+>/', $raw, $matches);
        $out = [];
        foreach ($matches[0] as $id) {
            $norm = strtolower(trim($id));
            if ($norm !== '' && $norm !== '<>') {
                $out[] = $norm;
            }
        }

        return $out;
    }
}
