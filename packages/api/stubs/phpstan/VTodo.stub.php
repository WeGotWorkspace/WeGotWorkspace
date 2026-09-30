<?php

namespace Sabre\VObject\Component;

use Sabre\VObject\Property\FlatText;
use Sabre\VObject\Property\FloatValue;
use Sabre\VObject\Property\ICalendar\CalAddress;
use Sabre\VObject\Property\ICalendar\DateTime;
use Sabre\VObject\Property\ICalendar\Duration;
use Sabre\VObject\Property\ICalendar\Period;
use Sabre\VObject\Property\ICalendar\Recur;
use Sabre\VObject\Property\IntegerValue;
use Sabre\VObject\Property\Text;
use Sabre\VObject\Property\Uri;

/**
 * iCalendar VTODO properties. Nullable because Component::__get() returns
 * null when the property is absent. Hyphenated names (PERCENT-COMPLETE,
 * RECURRENCE-ID, LAST-MODIFIED, RELATED-TO) stay on __get().
 * RDATE is DateTime or Period: VALUE=PERIOD (RFC 5545) selects Period.
 *
 * @property VAlarm|null $VALARM
 * @property CalAddress|null $ATTENDEE
 * @property Uri|null $ATTACH
 * @property Text|null $CATEGORIES
 * @property FlatText|null $CLASS
 * @property FlatText|null $COMMENT
 * @property DateTime|null $COMPLETED
 * @property FlatText|null $CONTACT
 * @property DateTime|null $CREATED
 * @property FlatText|null $DESCRIPTION
 * @property DateTime|null $DTEND
 * @property DateTime|null $DTSTAMP
 * @property DateTime|null $DTSTART
 * @property DateTime|null $DUE
 * @property Duration|null $DURATION
 * @property DateTime|null $EXDATE
 * @property Recur|null $EXRULE
 * @property FloatValue|null $GEO
 * @property FlatText|null $LOCATION
 * @property CalAddress|null $ORGANIZER
 * @property IntegerValue|null $PRIORITY
 * @property DateTime|Period|null $RDATE
 * @property Text|null $RESOURCES
 * @property Recur|null $RRULE
 * @property IntegerValue|null $SEQUENCE
 * @property FlatText|null $STATUS
 * @property FlatText|null $SUMMARY
 * @property FlatText|null $UID
 * @property Uri|null $URL
 */
class VTodo {}
