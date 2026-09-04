<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\UsesWgwConnection;
use Illuminate\Database\Eloquent\Model;

final class PrincipalPeer extends Model
{
    use UsesWgwConnection;

    protected $table = 'principal_peers';

    public $incrementing = false;

    public $timestamps = false;

    /** @var list<string> */
    protected $fillable = [
        'room',
        'peer_id',
        'name',
        'owner_user',
        'seen_at',
    ];
}
