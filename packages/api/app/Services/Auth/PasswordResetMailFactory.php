<?php

declare(strict_types=1);

namespace App\Services\Auth;

use App\Services\MailDelivery\OutboundMessage;
use App\Support\ApiUrlBuilder;

final class PasswordResetMailFactory
{
    public function __construct(private ApiUrlBuilder $urls) {}

    public function message(string $from, string $to, string $token): OutboundMessage
    {
        $link = $this->urls->appPath('login/reset').'?token='.$token;

        return new OutboundMessage(
            from: $from,
            to: [$to],
            subject: 'Reset your WeGotWorkspace password',
            textBody: implode("\n", [
                'A password reset was requested for your WeGotWorkspace account.',
                '',
                'Open this link to choose a new password (valid for 15 minutes):',
                $link,
                '',
                'If you did not request this, you can ignore this message.',
                'This message being submitted does not mean it reached an inbox.',
            ]),
        );
    }
}
