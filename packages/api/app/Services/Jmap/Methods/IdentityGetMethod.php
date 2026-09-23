<?php

declare(strict_types=1);

namespace App\Services\Jmap\Methods;

use App\Services\Jmap\JmapCapabilities;
use App\Services\Jmap\Mail\JmapMailService;
use App\Services\Jmap\Methods\Concerns\HandlesGetArguments;

final class IdentityGetMethod implements JmapMethodInterface
{
    use HandlesGetArguments;

    public function __construct(private JmapMailService $mail) {}

    public function name(): string
    {
        return 'Identity/get';
    }

    public function capability(): string
    {
        return JmapCapabilities::MAIL;
    }

    public function requiresAccountId(): bool
    {
        return true;
    }

    public function handle(string $username, array $args): array
    {
        $result = $this->mail->identityGet($username);
        $ids = $this->requestedIds($args);
        if ($ids !== null) {
            $byId = [];
            foreach ($result['list'] as $row) {
                $byId[$row['id']] = $row;
            }
            $list = [];
            $notFound = [];
            foreach ($ids as $id) {
                if (isset($byId[$id])) {
                    $list[] = $byId[$id];
                } else {
                    $notFound[] = $id;
                }
            }
            $result['list'] = $list;
            $result['notFound'] = $notFound;
        }
        $result['list'] = $this->projectProperties($result['list'], $args);

        return $result;
    }
}
