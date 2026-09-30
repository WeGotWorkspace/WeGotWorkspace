<?php

namespace Sabre\VObject\Component;

use Sabre\VObject\Property;
use Sabre\VObject\Property\FlatText;
use Sabre\VObject\Property\ICalendar\DateTime;
use Sabre\VObject\Property\ICalendar\Duration;
use Sabre\VObject\Property\IntegerValue;
use Sabre\VObject\Property\Uri;

/**
 * VALARM properties. TRIGGER is Property because VALUE=DATE-TIME overrides
 * the default Duration class. ACKNOWLEDGED is a plain identifier.
 *
 * @property DateTime|null $ACKNOWLEDGED
 * @property FlatText|null $ACTION
 * @property Uri|null $ATTACH
 * @property FlatText|null $DESCRIPTION
 * @property Duration|null $DURATION
 * @property IntegerValue|null $REPEAT
 * @property FlatText|null $SUMMARY
 * @property Property|null $TRIGGER
 */
class VAlarm {}
