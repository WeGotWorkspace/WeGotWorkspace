<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\UsesWgwConnection;
use Illuminate\Database\Eloquent\Model;

final class AddressBookShareDismissal extends Model
{
    use UsesWgwConnection;

    protected $table = 'addressbook_share_dismissals';

    public $timestamps = false;

    /** @var list<string> */
    protected $fillable = [
        'username',
        'addressbookid',
        'dismissed_at',
    ];

    /** @var array<string, string> */
    protected $casts = [
        'dismissed_at' => 'datetime',
        'addressbookid' => 'integer',
    ];
}
