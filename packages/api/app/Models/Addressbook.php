<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\UsesWgwConnection;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * Columns on the wgw table. Larastan does not see `$this->wgw()` migrations.
 * Nullability follows Sabre's MySQL and SQLite bundles: nullable when either allows NULL.
 *
 * @property int $id
 * @property string|null $principaluri
 * @property string|null $displayname
 * @property string|null $uri
 * @property string|null $description
 * @property int $synctoken
 */
final class Addressbook extends Model
{
    use UsesWgwConnection;

    protected $table = 'addressbooks';

    public $timestamps = false;

    /** @var list<string> */
    protected $fillable = [
        'principaluri',
        'displayname',
        'uri',
        'description',
        'synctoken',
    ];

    /** @return HasMany<Card, $this> */
    public function cards(): HasMany
    {
        return $this->hasMany(Card::class, 'addressbookid');
    }
}
