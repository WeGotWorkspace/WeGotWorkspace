<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\UsesWgwConnection;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;

/**
 * Columns on the wgw table. Larastan does not see `$this->wgw()` migrations.
 *
 * @property int $id
 * @property string $username
 * @property int $addressbookid
 * @property Carbon $dismissed_at
 */
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
