<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\UsesWgwConnection;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

final class AddressBookShare extends Model
{
    use UsesWgwConnection;

    protected $table = 'addressbook_shares';

    public $timestamps = false;

    /** @var list<string> */
    protected $fillable = [
        'addressbookid',
        'principaluri',
        'href',
        'access',
        'displayname',
    ];

    /** @var array<string, string> */
    protected $casts = [
        'addressbookid' => 'integer',
        'access' => 'integer',
    ];

    /** @return BelongsTo<Addressbook, $this> */
    public function addressbook(): BelongsTo
    {
        return $this->belongsTo(Addressbook::class, 'addressbookid');
    }
}
