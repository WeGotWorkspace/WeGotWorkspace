<?php

namespace Sabre\VObject\Component;

use Sabre\VObject\Property\FlatText;

/**
 * Children and calendar properties read through Component::__get().
 * Nullable: a missing child is null.
 *
 * @property VEvent|null $VEVENT
 * @property VTodo|null $VTODO
 * @property VJournal|null $VJOURNAL
 * @property VTimeZone|null $VTIMEZONE
 * @property VAlarm|null $VALARM
 * @property VFreeBusy|null $VFREEBUSY
 * @property FlatText|null $CALSCALE
 * @property FlatText|null $METHOD
 * @property FlatText|null $PRODID
 * @property FlatText|null $VERSION
 */
class VCalendar {}
