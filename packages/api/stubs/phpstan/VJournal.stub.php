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
 * Written fields use @property-read for the Sabre type and @property-write
 * for the scalars __set() accepts. An array written to DESCRIPTION is an error;
 * CATEGORIES still accepts a list of strings.
 *
 * @property-read Text|null $CATEGORIES
 * @property-write string|list<string>|Text $CATEGORIES
 * @property FlatText|null $CLASS
 * @property DateTime|null $CREATED
 * @property-read FlatText|null $DESCRIPTION
 * @property-write string|int|FlatText $DESCRIPTION
 * @property DateTime|null $DTSTAMP
 * @property DateTime|null $DTSTART
 * @property-read IntegerValue|null $SEQUENCE
 * @property-write string|int|IntegerValue $SEQUENCE
 * @property-read FlatText|null $STATUS
 * @property-write string|int|FlatText $STATUS
 * @property-read FlatText|null $SUMMARY
 * @property-write string|int|FlatText $SUMMARY
 * @property FlatText|null $UID
 */
class VJournal {}
