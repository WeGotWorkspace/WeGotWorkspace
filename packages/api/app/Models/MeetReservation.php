<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\UsesWgwConnection;
use Illuminate\Database\Eloquent\Model;

final class MeetReservation extends Model
{
    use UsesWgwConnection;

    protected $table = 'meet_reservations';

    public $incrementing = false;

    protected $keyType = 'string';

    /** @var list<string> */
    protected $fillable = [
        'id',
        'owner_principal',
        'created_by',
        'expires_at',
        'activated_at',
    ];

    protected function casts(): array
    {
        return [
            'expires_at' => 'datetime',
            'activated_at' => 'datetime',
        ];
    }
}
