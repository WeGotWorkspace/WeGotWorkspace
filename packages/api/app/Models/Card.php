<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\UsesWgwConnection;
use App\Services\Contacts\CardUid;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Columns on the wgw table. Larastan does not see `$this->wgw()` migrations.
 * Nullability follows Sabre's MySQL and SQLite bundles: nullable when either allows NULL.
 *
 * @property int $id
 * @property int $addressbookid
 * @property string|null $carddata
 * @property string|null $uri
 * @property int|null $lastmodified
 * @property string|null $etag
 * @property int|null $size
 * @property string|null $uid Normalized vCard UID ({@see CardUid}), unique per address book
 */
final class Card extends Model
{
    use UsesWgwConnection;

    protected $table = 'cards';

    public $timestamps = false;

    /** @var list<string> */
    protected $fillable = [
        'addressbookid',
        'carddata',
        'uri',
        'lastmodified',
        'etag',
        'size',
        'uid',
    ];

    /** @return BelongsTo<Addressbook, $this> */
    public function addressbook(): BelongsTo
    {
        return $this->belongsTo(Addressbook::class, 'addressbookid');
    }
}
