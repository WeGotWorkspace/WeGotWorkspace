<?php

namespace Sabre\VObject;

/**
 * sabre/vobject 4 add() is variadic at runtime. Its vendor return type is Node,
 * which has no add() and no component properties, so callers that keep the
 * result cannot chain add(). The stub types the return as Component.
 * Callers narrow VEVENT, VTODO, and VJOURNAL with instanceof.
 *
 * Magic property types live on the component stubs (VEvent, VTodo, VCard,
 * VJournal, VCalendar, VAlarm). Vendor __get() remains Property|null for
 * names those stubs do not declare, including hyphenated properties.
 *
 * $group is a real field on Property. add('EMAIL') returns a property at
 * runtime, but this stub types every add() result as Component so component
 * results keep add(). The property tag lets vCard writers set the group.
 *
 * @property string|null $group
 */
abstract class Component
{
    /**
     * @return Component
     */
    public function add() {}
}

/**
 * Declared so stub validation can resolve Property phpdocs. The real class
 * still supplies methods; this stub only names the symbol.
 */
abstract class Property {}
