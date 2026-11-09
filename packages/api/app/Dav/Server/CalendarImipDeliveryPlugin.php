<?php

declare(strict_types=1);

namespace App\Dav\Server;

use App\Services\Calendars\CalendarDavImipDelivery;
use App\Services\Calendars\CalendarPrincipalAddresses;
use Sabre\CalDAV\Schedule\IMipPlugin;
use Sabre\DAV\Auth\Plugin as AuthPlugin;
use Sabre\DAV\Server;
use Sabre\VObject\ITip\Message;

/**
 * iMIP for CalDAV clients (#1929). Sabre's Schedule plugin delivers to local
 * principals only; an invite, update, cancel or reply a native client writes
 * for an address outside the instance went nowhere. This plugin hands a
 * message for a recipient with no local principal to
 * {@see CalendarDavImipDelivery}, which applies the web app's iMIP rules
 * (external invites setting, per-organiser caps, mail transport). When the
 * message is skipped, the schedule-status stays what Sabre set before (no
 * mail, as before this plugin).
 *
 * It replaces the stock mail() delivery of Sabre's IMipPlugin and keeps its
 * place on the `schedule` event: priority 120, after local delivery at 100.
 */
final class CalendarImipDeliveryPlugin extends IMipPlugin
{
    private ?Server $davServer = null;

    public function __construct(
        private readonly CalendarDavImipDelivery $delivery,
        private readonly CalendarPrincipalAddresses $addresses,
    ) {
        // The sender address comes from the instance mail settings instead.
        parent::__construct('');
    }

    public function initialize(Server $server): void
    {
        $this->davServer = $server;
        parent::initialize($server);
    }

    public function getPluginName(): string
    {
        return 'wgw-imip';
    }

    public function schedule(Message $iTipMessage): void
    {
        if ($this->deliveredLocally($iTipMessage) || ! $this->isExternalRecipient($iTipMessage)) {
            return;
        }
        $username = $this->currentUsername();
        if ($username === null) {
            return;
        }
        $this->delivery->deliver($username, $iTipMessage);
    }

    private function deliveredLocally(Message $message): bool
    {
        return str_starts_with((string) $message->scheduleStatus, '1.');
    }

    private function isExternalRecipient(Message $message): bool
    {
        $recipient = (string) $message->recipient;

        return strtolower((string) parse_url($recipient, PHP_URL_SCHEME)) === 'mailto'
            && $this->addresses->principalForMailto($recipient) === null;
    }

    /** The signed-in DAV user: the iMIP caps count against them, as on the web app. */
    private function currentUsername(): ?string
    {
        $auth = $this->davServer?->getPlugin('auth');
        if (! $auth instanceof AuthPlugin) {
            return null;
        }
        $principal = (string) $auth->getCurrentPrincipal();
        if (! str_starts_with($principal, 'principals/')) {
            return null;
        }
        $username = substr($principal, strlen('principals/'));

        return $username === '' || str_contains($username, '/') ? null : $username;
    }
}
