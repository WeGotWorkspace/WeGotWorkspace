<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\UsesWgwConnection;
use Illuminate\Database\Eloquent\Model;

/**
 * Columns on the wgw table. Larastan does not see `$this->wgw()` migrations.
 *
 * @property int $id
 * @property string $room
 * @property string $from_peer
 * @property string $to_peer
 * @property string $type
 * @property string $payload
 * @property int $created_at
 */
final class PrincipalMessage extends Model
{
    use UsesWgwConnection;

    protected $table = 'principal_messages';

    public $timestamps = false;

    /** @var list<string> */
    protected $fillable = [
        'room',
        'from_peer',
        'to_peer',
        'type',
        'payload',
        'created_at',
    ];
}
