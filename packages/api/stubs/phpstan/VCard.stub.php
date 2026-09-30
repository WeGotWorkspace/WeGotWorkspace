<?php

namespace Sabre\VObject\Component;

use Sabre\VObject\Property;
use Sabre\VObject\Property\Binary;
use Sabre\VObject\Property\FlatText;
use Sabre\VObject\Property\Text;
use Sabre\VObject\Property\Uri;
use Sabre\VObject\Property\VCard\DateAndOrTime;
use Sabre\VObject\Property\VCard\LanguageTag;
use Sabre\VObject\Property\VCard\TimeStamp;

/**
 * vCard properties. Nullable because Component::__get() returns null when
 * the property is absent. Hyphenated names stay on __get().
 *
 * @property Text|null $ADR
 * @property DateAndOrTime|null $ANNIVERSARY
 * @property DateAndOrTime|null $BDAY
 * @property FlatText|null $BIRTHPLACE
 * @property Uri|null $CALADRURI
 * @property Uri|null $CALURI
 * @property Uri|null $CAPURI
 * @property Text|null $CATEGORIES
 * @property FlatText|null $CLASS
 * @property Text|null $CLIENTPIDMAP
 * @property Property|null $CREATED
 * @property DateAndOrTime|null $DEATHDATE
 * @property FlatText|null $DEATHPLACE
 * @property FlatText|null $EMAIL
 * @property FlatText|null $EXPERTISE
 * @property Uri|null $FBURL
 * @property FlatText|null $FN
 * @property Text|null $GENDER
 * @property FlatText|null $GEO
 * @property Property|null $GRAMGENDER
 * @property FlatText|null $HOBBY
 * @property Uri|null $IMPP
 * @property FlatText|null $INTEREST
 * @property FlatText|null $KEY
 * @property FlatText|null $KIND
 * @property FlatText|null $LABEL
 * @property LanguageTag|null $LANG
 * @property Property|null $LANGUAGE
 * @property Binary|null $LOGO
 * @property FlatText|null $MAILER
 * @property Uri|null $MEMBER
 * @property Text|null $N
 * @property Text|null $NICKNAME
 * @property FlatText|null $NOTE
 * @property Text|null $ORG
 * @property Binary|null $PHOTO
 * @property FlatText|null $PRODID
 * @property Property|null $PRONOUNS
 * @property Uri|null $RELATED
 * @property TimeStamp|null $REV
 * @property FlatText|null $ROLE
 * @property Property|null $SOCIALPROFILE
 * @property FlatText|null $SOUND
 * @property Uri|null $SOURCE
 * @property FlatText|null $TEL
 * @property FlatText|null $TITLE
 * @property Text|null $TZ
 * @property FlatText|null $UID
 * @property Uri|null $URL
 * @property FlatText|null $VERSION
 * @property FlatText|null $XML
 */
class VCard {}
