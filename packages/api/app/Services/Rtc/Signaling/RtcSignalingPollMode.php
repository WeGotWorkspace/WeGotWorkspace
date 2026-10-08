<?php

declare(strict_types=1);

namespace App\Services\Rtc\Signaling;

enum RtcSignalingPollMode
{
    /** Return messages with id > since; keep rows until pruned. */
    case SinceCursor;

    /** Return undelivered messages and delete them after read. */
    case DeleteOnRead;
}
