<?php

namespace Sabre\VObject;

/**
 * sabre/vobject 4 add() is variadic at runtime. Its vendor return type is Node,
 * which has no add() and no component properties, so chained calls fail at
 * level 2. The stub types the return as Component. Magic __get/__set still
 * covers property names, including parameter fields such as group.
 */
abstract class Component
{
    /**
     * @return Component
     */
    public function add() {}

    /**
     * First child with this name. Vendor code types the match as Property,
     * but select() also returns components such as VEVENT. mixed keeps both
     * property methods and component instanceof checks valid.
     *
     * @return mixed
     */
    public function __get(string $name) {}
}
