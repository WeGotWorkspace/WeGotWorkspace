<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\UsesWgwConnection;
use Illuminate\Database\Eloquent\Model;

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
