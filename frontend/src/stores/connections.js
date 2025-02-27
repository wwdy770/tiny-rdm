import { defineStore } from 'pinia'
import { get, isEmpty, uniq } from 'lodash'
import {
    CreateGroup,
    DeleteConnection,
    DeleteGroup,
    GetConnection,
    ListConnection,
    RenameGroup,
    SaveConnection,
    SaveSortedConnection,
} from 'wailsjs/go/services/connectionService.js'
import { ConnectionType } from '@/consts/connection_type.js'
import { KeyViewType } from '@/consts/key_view_type.js'
import useBrowserStore from 'stores/browser.js'

const useConnectionStore = defineStore('connections', {
    /**
     * @typedef {Object} ConnectionItem
     * @property {string} key
     * @property {string} label display label
     * @property {string} name database name
     * @property {number} type
     * @property {boolean} cluster is cluster node
     * @property {ConnectionItem[]} children
     */

    /**
     * @typedef {Object} ConnectionProfile
     * @property {string} defaultFilter
     * @property {string} keySeparator
     * @property {string} markColor
     */

    /**
     * @typedef {Object} ConnectionState
     * @property {string[]} groups
     * @property {ConnectionItem[]} connections
     * @property {Object.<string, ConnectionProfile>} serverProfile
     */

    /**
     *
     * @returns {ConnectionState}
     */
    state: () => ({
        groups: [], // all group name set
        connections: [], // all connections
        serverProfile: {}, // all server profile in flat list
    }),
    getters: {},
    actions: {
        /**
         * load all store connections struct from local profile
         * @param {boolean} [force]
         * @returns {Promise<void>}
         */
        async initConnections(force) {
            if (!force && !isEmpty(this.connections)) {
                return
            }
            const conns = []
            const groups = []
            const profiles = {}
            const { data = [{ groupName: '', connections: [] }] } = await ListConnection()
            for (const conn of data) {
                if (conn.type !== 'group') {
                    // top level
                    conns.push({
                        key: '/' + conn.name,
                        label: conn.name,
                        name: conn.name,
                        type: ConnectionType.Server,
                        cluster: get(conn, 'cluster.enable', false),
                        // isLeaf: false,
                    })
                    profiles[conn.name] = {
                        defaultFilter: conn.defaultFilter,
                        keySeparator: conn.keySeparator,
                        markColor: conn.markColor,
                    }
                } else {
                    // custom group
                    groups.push(conn.name)
                    const subConns = get(conn, 'connections', [])
                    const children = []
                    for (const item of subConns) {
                        const value = conn.name + '/' + item.name
                        children.push({
                            key: value,
                            label: item.name,
                            name: item.name,
                            type: ConnectionType.Server,
                            cluster: get(item, 'cluster.enable', false),
                            // isLeaf: false,
                        })
                        profiles[item.name] = {
                            defaultFilter: item.defaultFilter,
                            keySeparator: item.keySeparator,
                            markColor: item.markColor,
                        }
                    }
                    conns.push({
                        key: conn.name + '/',
                        label: conn.name,
                        type: ConnectionType.Group,
                        children,
                    })
                }
            }
            this.connections = conns
            this.serverProfile = profiles
            this.groups = uniq(groups)
        },

        /**
         * get connection by name from local profile
         * @param name
         * @returns {Promise<ConnectionProfile|null>}
         */
        async getConnectionProfile(name) {
            try {
                const { data, success } = await GetConnection(name)
                if (success) {
                    this.serverProfile[name] = {
                        defaultFilter: data.defaultFilter,
                        keySeparator: data.keySeparator,
                        markColor: data.markColor,
                    }
                    return data
                }
            } finally {
            }
            return null
        },

        /**
         * create a new default connection
         * @param {string} [name]
         * @returns {{}}
         */
        newDefaultConnection(name) {
            return {
                group: '',
                name: name || '',
                addr: '127.0.0.1',
                port: 6379,
                username: '',
                password: '',
                defaultFilter: '*',
                keySeparator: ':',
                connTimeout: 60,
                execTimeout: 60,
                dbFilterType: 'none',
                dbFilterList: [],
                keyView: KeyViewType.Tree,
                loadSize: 10000,
                markColor: '',
                ssl: {
                    enable: false,
                    certFile: '',
                    keyFile: '',
                    caFile: '',
                },
                ssh: {
                    enable: false,
                    addr: '',
                    port: 22,
                    loginType: 'pwd',
                    username: '',
                    password: '',
                    pkFile: '',
                    passphrase: '',
                },
                sentinel: {
                    enable: false,
                    master: 'mymaster',
                    username: '',
                    password: '',
                },
                cluster: {
                    enable: false,
                },
            }
        },

        mergeConnectionProfile(dest, src) {
            const mergeObj = (destObj, srcObj) => {
                for (const k in srcObj) {
                    const t = typeof srcObj[k]
                    if (t === 'string') {
                        destObj[k] = srcObj[k] || destObj[k] || ''
                    } else if (t === 'number') {
                        destObj[k] = srcObj[k] || destObj[k] || 0
                    } else if (t === 'object') {
                        mergeObj(destObj[k], srcObj[k] || {})
                    } else {
                        destObj[k] = srcObj[k]
                    }
                }
                return destObj
            }
            return mergeObj(dest, src)
        },

        /**
         * get database server by name
         * @param name
         * @returns {ConnectionItem|null}
         */
        getConnection(name) {
            const conns = this.connections
            for (let i = 0; i < conns.length; i++) {
                if (conns[i].type === ConnectionType.Server && conns[i].key === name) {
                    return conns[i]
                } else if (conns[i].type === ConnectionType.Group) {
                    const children = conns[i].children
                    for (let j = 0; j < children.length; j++) {
                        if (children[j].type === ConnectionType.Server && conns[i].key === name) {
                            return children[j]
                        }
                    }
                }
            }
            return null
        },

        /**
         * create a new connection or update current connection profile
         * @param {string} name set null if create a new connection
         * @param {{}} param
         * @returns {Promise<{success: boolean, [msg]: string}>}
         */
        async saveConnection(name, param) {
            const { success, msg } = await SaveConnection(name, param)
            if (!success) {
                return { success: false, msg }
            }

            // reload connection list
            await this.initConnections(true)
            return { success: true }
        },

        /**
         * save connection after sort
         * @returns {Promise<void>}
         */
        async saveConnectionSorted() {
            const mapToList = (conns) => {
                const list = []
                for (const conn of conns) {
                    if (conn.type === ConnectionType.Group) {
                        const children = mapToList(conn.children)
                        list.push({
                            name: conn.label,
                            type: 'group',
                            connections: children,
                        })
                    } else if (conn.type === ConnectionType.Server) {
                        list.push({
                            name: conn.name,
                        })
                    }
                }
                return list
            }
            const s = mapToList(this.connections)
            SaveSortedConnection(s)
        },

        /**
         * remove connection
         * @param name
         * @returns {Promise<{success: boolean, [msg]: string}>}
         */
        async deleteConnection(name) {
            // close connection first
            const browser = useBrowserStore()
            await browser.closeConnection(name)
            const { success, msg } = await DeleteConnection(name)
            if (!success) {
                return { success: false, msg }
            }
            await this.initConnections(true)
            return { success: true }
        },

        /**
         * create a connection group
         * @param name
         * @returns {Promise<{success: boolean, [msg]: string}>}
         */
        async createGroup(name) {
            const { success, msg } = await CreateGroup(name)
            if (!success) {
                return { success: false, msg }
            }
            await this.initConnections(true)
            return { success: true }
        },

        /**
         * rename connection group
         * @param name
         * @param newName
         * @returns {Promise<{success: boolean, [msg]: string}>}
         */
        async renameGroup(name, newName) {
            if (name === newName) {
                return { success: true }
            }
            const { success, msg } = await RenameGroup(name, newName)
            if (!success) {
                return { success: false, msg }
            }
            await this.initConnections(true)
            return { success: true }
        },

        /**
         * delete group by name
         * @param {string} name
         * @param {boolean} [includeConn]
         * @returns {Promise<{success: boolean, [msg]: string}>}
         */
        async deleteGroup(name, includeConn) {
            const { success, msg } = await DeleteGroup(name, includeConn === true)
            if (!success) {
                return { success: false, msg }
            }
            await this.initConnections(true)
            return { success: true }
        },

        /**
         * get default key filter pattern by server name
         * @param name
         * @return {string}
         */
        getDefaultKeyFilter(name) {
            const { defaultFilter = '*' } = this.serverProfile[name] || {}
            return defaultFilter
        },

        /**
         * get default key separator by server name
         * @param name
         * @return {string}
         */
        getDefaultSeparator(name) {
            const { defaultSeparator = ':' } = this.serverProfile[name] || {}
            return defaultSeparator
        },
    },
})

export default useConnectionStore
