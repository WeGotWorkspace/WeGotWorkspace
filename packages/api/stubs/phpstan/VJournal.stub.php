<?php

namespace Sabre\VObject\Component;

use Sabre\VObject\Property\FlatText;
use Sabre\VObject\Property\ICalendar\DateTime;
use Sabre\VObject\Property\IntegerValue;
use Sabre\VObject\Property\Text;

/**
 * iCalendar VJOURNAL properties used by notes, docs threads, and chat.
 * Nullable because Component::__get() returns null when the property is absent.
 * Hyphenated X-WGW-* and RELATED-TO names stay on __get().
 *
 * @property Text|null $CATEGORIES
 * @property FlatText|null $CLASS
 * @property DateTime|null $CREATED
 * @property FlatText|null $DESCRIPTION
 * @property DateTime|null $DTSTAMP
 * @property DateTime|null $DTSTART
 * @property IntegerValue|null $SEQUENCE
 * @property FlatText|null $STATUS
 * @property FlatText|null $SUMMARY
 * @property FlatText|null $UID
 */
class VJournal {}
