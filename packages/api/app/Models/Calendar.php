<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\UsesWgwConnection;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

final class Calendar extends Model
{
    use UsesWgwConnection;

    protected $table = 'calendars';

    public $timestamps = false;

    /** @var list<string> */
    protected $fillable = [
        'synctoken',
        'components',
    ];

    /** @return HasMany<CalendarInstance, $this> */
    public function instances(): HasMany
    {
        return $this->hasMany(CalendarInstance::class, 'calendarid');
    }

    /** @return HasMany<CalendarObject, $this> */
    public function objects(): HasMany
    {
        return $this->hasMany(CalendarObject::class, 'calendarid');
    }

    public function supportsVtodo(): bool
    {
        $components = (string) ($this->components ?? '');

        return str_contains($components, 'VTODO');
    }

    public function supportsVevent(): bool
    {
        $components = (string) ($this->components ?? '');

        return str_contains($components, 'VEVENT');
    }

    public function supportsVjournal(): bool
    {
        $components = (string) ($this->components ?? '');

        return str_contains($components, 'VJOURNAL');
    }

    public function isVtodoOnly(): bool
    {
        return $this->supportsVtodo() && ! $this->supportsVevent();
    }

    public function isVjournalOnly(): bool
    {
        return $this->supportsVjournal() && ! $this->supportsVevent() && ! $this->supportsVtodo();
    }

    public function isMixed(): bool
    {
        return $this->supportsVtodo() && $this->supportsVevent();
    }

    /**
     * Calendars whose supported component set includes VTODO (legacy mixed or VTODO-only).
     *
     * @param  Builder<Calendar>  $query
     */
    public function scopeSupportsVtodo(Builder $query): void
    {
        $query->where('components', 'like', '%VTODO%');
    }

    /**
     * VTODO-only collections (strict task lists).
     *
     * @param  Builder<Calendar>  $query
     */
    public function scopeVtodoOnly(Builder $query): void
    {
        $query->where('components', 'like', '%VTODO%')
            ->where('components', 'not like', '%VEVENT%');
    }

    /**
     * Calendars that can store VEVENT (excludes VTODO-only collections).
     *
     * @param  Builder<Calendar>  $query
     */
    public function scopeSupportsVevent(Builder $query): void
    {
        $query->where('components', 'like', '%VEVENT%');
    }

    /**
     * VJOURNAL-only collections (notebooks). Excludes event calendars and task lists.
     *
     * @param  Builder<Calendar>  $query
     */
    public function scopeVjournalOnly(Builder $query): void
    {
        $query->where('components', 'like', '%VJOURNAL%')
            ->where('components', 'not like', '%VEVENT%')
            ->where('components', 'not like', '%VTODO%');
    }
}
