<?php

namespace Sabre\VObject\ITip;

/**
 * Vendor phpdoc types $calendar as VCalendar|string. parseEvent treats null
 * as an organizer delete (CANCEL) and a null $oldCalendar as a new invite.
 */
class Broker
{
    /**
     * @param  string|array<int, string>  $userHref
     * @return array<int, mixed>
     */
    public function parseEvent(?string $calendar, $userHref, ?string $oldCalendar = null) {}
}
