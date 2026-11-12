<?php

declare(strict_types=1);

namespace App\Dav\Server;

use App\Services\Calendars\CalendarSchedulingNotifier;
use Sabre\DAV\Server;
use Sabre\DAV\ServerPlugin;
use Sabre\DAVACL\Plugin as AclPlugin;
use Sabre\VObject\ITip\Message;

/**
 * Suite notifications for scheduling a CalDAV client does (#2057). An invite,
 * reschedule, RSVP or cancel written by Apple Calendar or Thunderbird goes
 * through Sabre's Schedule plugin, which lands it in the recipient's inbox and
 * calendar but knows nothing of the suite's notifications. This plugin runs
 * on the same `schedule` event right after that local delivery and, when the
 * message was delivered (schedule status 1.x) and is one the web app would
 * send, notifies as the web app does
 * ({@see CalendarSchedulingNotifier}). Status 5.0 means the message reached the
 * inbox but Sabre had no copy of the event to apply it to; a CANCEL or REPLY
 * still notifies then (the web app clears the invite and rings the organizer
 * either way), a REQUEST does not.
 *
 * Priority 110: after {@see CalendarScheduleDeliveryGuardPlugin} (90) and
 * Sabre's local delivery (100), before iMIP (120). A refused delivery stops
 * the event earlier, so it never notifies.
 */
final class CalendarScheduleNotifyPlugin extends ServerPlugin
{
    private const PRIORITY = 110;

    private ?Server $server = null;

    public function __construct(
        private readonly CalendarSchedulingNotifier $notifier,
    ) {}

    public function initialize(Server $server): void
    {
        $this->server = $server;
        $server->on('schedule', [$this, 'afterLocalDelivery'], self::PRIORITY);
    }

    public function getPluginName(): string
    {
        return 'wgw-schedule-notify';
    }

    public function afterLocalDelivery(Message $message): void
    {
        $status = (string) $message->scheduleStatus;
        $method = strtoupper((string) $message->method);
        $delivered = str_starts_with($status, '1.')
            || (str_starts_with($status, '5.0') && in_array($method, ['CANCEL', 'REPLY'], true));
        if (! $delivered) {
            return;
        }
        // Sabre also delivers a minor update (a new description); the web app
        // sends none, so the attendee's bell does not ring again for it.
        if ($method === 'REQUEST' && ! $message->significantChange) {
            return;
        }
        $sender = DavCurrentUsername::of($this->server);
        $acl = $this->server?->getPlugin('acl');
        if ($sender === null || ! $acl instanceof AclPlugin) {
            return;
        }
        $recipient = $acl->getPrincipalByUri((string) $message->recipient);
        if (! is_string($recipient) || ! str_starts_with($recipient, 'principals/')) {
            return;
        }
        $this->notifier->delivered($sender, $recipient, $message);
    }
}
