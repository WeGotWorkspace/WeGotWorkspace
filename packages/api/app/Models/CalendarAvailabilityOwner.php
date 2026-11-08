<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\UsesWgwConnection;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;

/**
 * Columns on the wgw table. Larastan does not see `$this->wgw()` migrations.
 *
 * @property string $principal_uri
 * @property bool $enabled
 * @property Carbon $updated_at
 */
final class CalendarAvailabilityOwner extends Model
{
    use UsesWgwConnection;

    protected $table = 'calendar_availability_owners';

    protected $primaryKey = 'principal_uri';

    public $incrementing = false;

    protected $keyType = 'string';

    public $timestamps = false;

    protected $dateFormat = 'Y-m-d H:i:s.u';

    /** @var list<string> */
    protected $fillable = [
        'principal_uri',
        'enabled',
        'updated_at',
    ];

    /** @var array<string, string> */
    protected $casts = [
        'enabled' => 'boolean',
        'updated_at' => 'datetime',
    ];
}
