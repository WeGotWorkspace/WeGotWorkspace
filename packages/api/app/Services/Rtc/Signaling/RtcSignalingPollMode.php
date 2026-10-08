<?php

declare(strict_types=1);

namespace App\Services\Rtc\Signaling;

enum RtcSignalingPollMode
{
    /**
     * Return messages with id > since. Rows live until pruned, or — when the policy
     * sets `sinceAckCap` — until the cursor acks them.
     */
    case SinceCursor;

    /** Return undelivered messages and delete them after read. */
    case DeleteOnRead;
}
