<?php

declare(strict_types=1);

namespace App\Database;

use Illuminate\Database\Eloquent\Builder as EloquentBuilder;
use Illuminate\Database\Query\Builder;

/**
 * A conditional UPDATE whose WHERE clause is the guard (a lease token, an
 * expected state): it reports whether the guarded row matched, not whether a
 * value changed.
 *
 * The drivers count differently: SQLite (and PostgreSQL) return the rows the
 * WHERE matched, MySQL returns the rows whose values changed. On MySQL a
 * renewal that writes the same second-precision `locked_until` again, or a
 * save whose values already equal the stored ones, reports 0 although the row
 * matched and the guard still holds. When nothing changed, this asks the
 * same WHERE once more: the row still matches only while the guard holds.
 */
final class GuardedUpdate
{
    /**
     * @param  Builder|EloquentBuilder<covariant \Illuminate\Database\Eloquent\Model>  $query  scoped to one row
     * @param  array<string, mixed>  $values
     */
    public static function matched(Builder|EloquentBuilder $query, array $values): bool
    {
        $guard = clone $query;
        $affected = $query->update($values);
        if ($affected > 0) {
            return true;
        }

        return $guard->exists();
    }
}
